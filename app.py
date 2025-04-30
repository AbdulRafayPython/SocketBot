from flask import Flask, render_template, request, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import json
import time
from datetime import datetime
from database import db
from config import SECRET_KEY, CORS_ALLOWED_ORIGINS

app = Flask(__name__)
app.config['SECRET_KEY'] = SECRET_KEY
socketio = SocketIO(app, cors_allowed_origins=CORS_ALLOWED_ORIGINS)

# Store active users and their typing status
active_users = {}
typing_users = {}

@app.route('/')
def index():
    return render_template('index.html')

@socketio.on('connect')
def handle_connect():
    print('Client connected')

@socketio.on('disconnect')
def handle_disconnect():
    if 'username' in session:
        username = session['username']
        if username in active_users:
            del active_users[username]
            
        # Remove from typing users if present
        if username in typing_users:
            del typing_users[username]
            
        # Notify others that user has left
        emit('user_status', {
            'username': username,
            'status': 'offline',
            'active_users': list(active_users.keys())
        }, broadcast=True)
        
        print(f"User {username} disconnected")

@socketio.on('register')
def handle_registration(data):
    username = data.get('username')
    if not username:
        return
    
    # Store username in session
    session['username'] = username
    
    # Save user to database and get user_id
    user_id = db.save_user(username)
    if user_id:
        session['user_id'] = user_id
        
        # Add to active users
        active_users[username] = request.sid
        
        # Get recent messages
        recent_messages = db.get_recent_messages(50)
        # Reverse to display in chronological order
        recent_messages = recent_messages[::-1]
        
        # Format timestamps for display
        for msg in recent_messages:
            if isinstance(msg['created_at'], datetime):
                msg['created_at'] = msg['created_at'].strftime('%Y-%m-%d %H:%M:%S')
        
        # Send welcome message and chat history
        emit('registration_response', {
            'status': 'success',
            'username': username,
            'active_users': list(active_users.keys()),
            'recent_messages': recent_messages
        })
        
        # Notify others that a new user has joined
        emit('user_status', {
            'username': username,
            'status': 'online',
            'active_users': list(active_users.keys())
        }, broadcast=True, include_self=False)
        
        print(f"User {username} registered")

@socketio.on('chat_message')
def handle_message(data):
    if 'username' not in session or 'user_id' not in session:
        return
    
    username = session['username']
    user_id = session['user_id']
    message = data.get('message', '').strip()
    
    if not message:
        return
    
    # Save message to database
    message_record = db.save_message(user_id, message)
    
    if message_record:
        # Format timestamp for display
        if isinstance(message_record['created_at'], datetime):
            message_record['created_at'] = message_record['created_at'].strftime('%Y-%m-%d %H:%M:%S')
        
        # Broadcast message to all clients
        emit('new_message', {
            'username': username,
            'message': message,
            'timestamp': message_record['created_at']
        }, broadcast=True)
        
        # Clear typing indicator for this user
        if username in typing_users:
            del typing_users[username]
            emit('typing_status', {
                'username': username,
                'is_typing': False
            }, broadcast=True)

@socketio.on('typing')
def handle_typing(data):
    if 'username' not in session:
        return
    
    username = session['username']
    is_typing = data.get('is_typing', False)
    
    if is_typing:
        typing_users[username] = time.time()
    elif username in typing_users:
        del typing_users[username]
    
    # Broadcast typing status to all other clients
    emit('typing_status', {
        'username': username,
        'is_typing': is_typing
    }, broadcast=True, include_self=False)

if __name__ == '__main__':
    socketio.run(app, host='127.0.0.1', port=8000, debug=True)