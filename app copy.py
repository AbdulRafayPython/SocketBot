from flask import Flask, render_template, request
from flask_socketio import SocketIO, emit
from database import db
import datetime
import re
import json

app = Flask(__name__)
app.config['SECRET_KEY'] = 'socketbot_secret_key'
socketio = SocketIO(app, cors_allowed_origins="*")

active_users = {}  # Dictionary to track active users: {socket_id: {'username': username, 'user_id': user_id}}
typing_users = {}  # Dictionary to track typing status: {socket_id: {'username': username, 'timestamp': timestamp}}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    """Handle new socket connection"""
    print(f"Client connected: {request.sid}")
    emit('connection_response', {'status': 'connected', 'socket_id': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    """Handle socket disconnection"""
    if request.sid in active_users:
        user = active_users[request.sid]
        username = user['username']
        user_id = user['user_id']
        
        # Update user status in DB
        db.set_user_status(user_id, 'offline')
        
        # Remove user from active users
        del active_users[request.sid]
        
        # Notify other clients
        emit('user_status', {
            'username': username,
            'status': 'offline',
            'active_users': get_active_usernames()
        }, broadcast=True)
        
        print(f"User {username} disconnected")

@socketio.on('register')
def handle_registration(data):
    """Handle user registration"""
    username = data.get('username', '').strip()
    
    # Validate username
    if not username:
        emit('registration_response', {'status': 'error', 'message': 'Username is required'})
        return
    
    # Check username format
    if not re.match(r'^[A-Za-z0-9_-]{3,20}$', username):
        emit('registration_response', {'status': 'error', 'message': 'Username must be 3-20 characters and contain only letters, numbers, underscores, and hyphens'})
        return
    
    # Check if username is already active
    for sid, user in active_users.items():
        if user['username'].lower() == username.lower():
            emit('registration_response', {'status': 'error', 'message': 'This username is already in use'})
            return
    
    try:
        # Save user to database
        user_id = db.save_user(username)
        
        if user_id:
            # Save user session
            db.save_user_session(
                user_id, 
                request.sid, 
                request.remote_addr, 
                request.headers.get('User-Agent', '')
            )
            
            # Add user to active users
            active_users[request.sid] = {
                'username': username,
                'user_id': user_id
            }
            
            # Get recent messages
            recent_messages = db.get_recent_messages(50)
            
            # Format messages for sending
            formatted_messages = []
            for msg in recent_messages:
                formatted_messages.append({
                    'id': msg['id'],
                    'username': msg['username'],
                    'message': msg['message'],
                    'message_type': msg['message_type'],
                    'created_at': format_timestamp(msg['created_at'])
                })
            
            # Send successful registration response
            emit('registration_response', {
                'status': 'success',
                'username': username,
                'recent_messages': formatted_messages
            })
            
            # Notify other clients about the new user
            emit('user_status', {
                'username': username,
                'status': 'online',
                'active_users': get_active_usernames()
            }, broadcast=True)
            
            print(f"User {username} registered")
        else:
            emit('registration_response', {'status': 'error', 'message': 'Error registering user'})
    except Exception as e:
        print(f"Registration error: {e}")
        emit('registration_response', {'status': 'error', 'message': 'Server error. Please try again.'})

@socketio.on('chat_message')
def handle_message(data):
    """Handle new chat message"""
    if request.sid not in active_users:
        return
    
    user = active_users[request.sid]
    user_id = user['user_id']
    username = user['username']
    message = data.get('message', '').strip()
    message_type = data.get('type', 'text')
    
    if not message:
        return
    
    # Save message to database
    saved_message = db.save_message(user_id, message, message_type)
    
    if saved_message:
        # Update user's last active time
        db.update_user_session(request.sid)
        
        # Format timestamp
        timestamp = format_timestamp(saved_message['created_at'])
        
        # Broadcast message to all clients
        emit('new_message', {
            'id': saved_message['id'],
            'username': username,
            'message': message,
            'message_type': message_type,
            'timestamp': timestamp
        }, broadcast=True)
        
        # Clear typing indicator for this user
        if request.sid in typing_users:
            del typing_users[request.sid]
            update_typing_status()

@socketio.on('typing')
def handle_typing(data):
    """Handle typing status updates"""
    if request.sid not in active_users:
        return
    
    is_typing = data.get('is_typing', False)
    username = active_users[request.sid]['username']
    
    if is_typing:
        # Add user to typing users
        typing_users[request.sid] = {
            'username': username,
            'timestamp': datetime.datetime.now()
        }
    else:
        # Remove user from typing users
        if request.sid in typing_users:
            del typing_users[request.sid]
    
    update_typing_status()

@socketio.on('get_users')
def handle_get_users():
    """Handle request for active users"""
    emit('active_users', {'users': get_active_usernames()})

def update_typing_status():
    """Broadcast current typing status to all clients"""
    # Clean up typing users that haven't typed for more than 3 seconds
    now = datetime.datetime.now()
    for sid in list(typing_users.keys()):
        if (now - typing_users[sid]['timestamp']).total_seconds() > 3:
            del typing_users[sid]
    
    # Get list of users who are typing
    users_typing = [user['username'] for user in typing_users.values()]
    
    # Broadcast typing status
    socketio.emit('typing_status', {'users': users_typing})

def get_active_usernames():
    """Get list of active usernames"""
    return [user['username'] for user in active_users.values()]

def format_timestamp(timestamp):
    """Format database timestamp for display"""
    if isinstance(timestamp, str):
        return timestamp
    
    return timestamp.strftime('%Y-%m-%d %H:%M:%S')

if __name__ == '__main__':
    socketio.run(app, debug=True, host='127.0.0.1', port=8000)