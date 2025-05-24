from flask import Flask, render_template, request, send_from_directory
from flask_socketio import SocketIO, emit
from database import db
import datetime
import re
import os
import uuid
from werkzeug.utils import secure_filename
import base64
import threading
import psutil


app = Flask(__name__)
app.config['SECRET_KEY'] = 'socketbot_secret_key'
app.config['UPLOAD_FOLDER'] = 'static/uploads'
app.config['ALLOWED_EXTENSIONS'] = {'png', 'jpg', 'jpeg', 'gif', 'mp3', 'wav'}

#TCP Handshaking
socketio = SocketIO(app, cors_allowed_origins="*")

#THREADS AND SOCKETS
def show_threads_and_sockets():
    print("\n========== 🧵 THREADS ==========")
    print(f"Total active threads: {threading.active_count()}")
    for thread in threading.enumerate():
        print(f"➡️ Name: {thread.name} | Daemon: {thread.daemon} | Alive: {thread.is_alive()}")

    print("\n========== 🔌 SOCKETS ==========")
    p = psutil.Process(os.getpid())  # Current Flask process
    connections = p.connections(kind='inet')  # Only sockets owned by this process
    for conn in connections:
        laddr = f"{conn.laddr.ip}:{conn.laddr.port}" if conn.laddr else "N/A"
        raddr = f"{conn.raddr.ip}:{conn.raddr.port}" if conn.raddr else "N/A"
        proto = "TCP" if conn.type == psutil.SOCK_STREAM else "UDP"
        print(f"➡️ Type: {proto} | Status: {conn.status} | Local: {laddr} | Remote: {raddr}")

@app.route("/check-system")
def check_system():
    show_threads_and_sockets()
    return "System info printed in terminal."

# Ensure upload folder exists
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

active_users = {}
typing_users = {}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/uploads/<filename>')
def uploaded_file(filename):
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

@socketio.on('connect')
def handle_connect():
    print(f"Client connected: {request.sid}")
    emit('connection_response', {'status': 'connected', 'socket_id': request.sid})

@socketio.on('disconnect')
def handle_disconnect():
    if request.sid in active_users:
        user = active_users[request.sid]
        username = user['username']
        user_id = user['user_id']
        db.set_user_status(user_id, 'offline')
        del active_users[request.sid]
        emit('user_status', {
            'username': username,
            'status': 'offline',
            'active_users': get_active_usernames()
        }, broadcast=True)
        print(f"User {username} disconnected")

@socketio.on('register')
def handle_registration(data):
    username = data.get('username', '').strip()
    if not username:
        emit('registration_response', {'status': 'error', 'message': 'Username is required'})
        return
    if not re.match(r'^[A-Za-z0-9_-]{3,20}$', username):
        emit('registration_response', {'status': 'error', 'message': 'Username must be 3-20 characters and contain only letters, numbers, underscores, and hyphens'})
        return
    for sid, user in active_users.items():
        if user['username'].lower() == username.lower():
            emit('registration_response', {'status': 'error', 'message': 'This username is already in use'})
            return
    try:
        user_id = db.save_user(username)
        if user_id:
            db.save_user_session(
                user_id, 
                request.sid, 
                request.remote_addr, 
                request.headers.get('User-Agent', '')
            )
            active_users[request.sid] = {
                'username': username,
                'user_id': user_id
            }
            recent_messages = db.get_recent_messages(50)
            formatted_messages = []
            for msg in recent_messages:
                statuses = db.get_message_status(msg['id'])
                formatted_statuses = {s['user_id']: s['status'] for s in statuses}
                # Mark messages as seen for the new user (except their own)
                if msg['username'] != username:
                    db.update_message_status(msg['id'], user_id, 'seen')
                    formatted_statuses[user_id] = 'seen'
                    emit('message_status', {
                        'message_id': msg['id'],
                        'user_id': user_id,
                        'status': 'seen'
                    }, broadcast=True)
                formatted_messages.append({
                    'id': msg['id'],
                    'username': msg['username'],
                    'message': msg['message'],
                    'message_type': msg['message_type'],
                    'file_path': msg['file_path'],
                    'timestamp': format_timestamp(msg['created_at']),
                    'statuses': formatted_statuses
                })
            emit('registration_response', {
                'status': 'success',
                'username': username,
                'recent_messages': formatted_messages
            })
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
    if request.sid not in active_users:
        return
    user = active_users[request.sid]
    user_id = user['user_id']
    username = user['username']
    message = data.get('message', '').strip()
    message_type = data.get('type', 'text')
    file_path = data.get('file_path')
    
    if message_type == 'text' and not message:
        return
    
    saved_message = db.save_message(user_id, message, message_type, file_path)
    
    if saved_message:
        db.update_user_session(request.sid)
        timestamp = format_timestamp(saved_message['created_at'])
        message_id = saved_message['id']
        # Initialize statuses dictionary
        statuses = {}
        # Check for other active users
        other_users = [u for sid, u in active_users.items() if u['user_id'] != user_id]
        if other_users:
            # Mark message as delivered for all other online users
            for sid, u in active_users.items():
                if u['user_id'] != user_id:
                    db.update_message_status(message_id, u['user_id'], 'delivered')
                    statuses[u['user_id']] = 'delivered'
        # If no other users, statuses remains empty (indicating "delivered" to frontend)
        
        emit('new_message', {
            'id': message_id,
            'username': username,
            'message': message,
            'message_type': message_type,
            'file_path': file_path,
            'timestamp': timestamp,
            'statuses': statuses
        }, broadcast=True)
        if request.sid in typing_users:
            del typing_users[request.sid]
            update_typing_status()

@socketio.on('upload_file')
def handle_file_upload(data):
    if request.sid not in active_users:
        return
    user = active_users[request.sid]
    file_data = data.get('file')
    file_type = data.get('type')  # 'image' or 'voice'
    
    if not file_data:
        emit('file_response', {'status': 'error', 'message': 'No file provided'})
        return
    
    try:
        header, encoded = file_data.split(',', 1)
        extension = 'png' if file_type == 'image' else 'mp3'
        filename = f"{uuid.uuid4()}.{extension}"
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        
        with open(filepath, 'wb') as f:
            f.write(base64.b64decode(encoded))
        
        message = f"Uploaded {file_type}"
        saved_message = db.save_message(user['user_id'], message, file_type, filename)
        
        if saved_message:
            timestamp = format_timestamp(saved_message['created_at'])
            message_id = saved_message['id']
            statuses = {}
            for sid, u in active_users.items():
                if u['user_id'] != user['user_id']:
                    db.update_message_status(message_id, u['user_id'], 'delivered')
                    statuses[u['user_id']] = 'delivered'
            emit('new_message', {
                'id': message_id,
                'username': user['username'],
                'message': message,
                'message_type': file_type,
                'file_path': filename,
                'timestamp': timestamp,
                'statuses': statuses
            }, broadcast=True)
            emit('file_response', {'status': 'success', 'message': 'File uploaded'})
        else:
            emit('file_response', {'status': 'error', 'message': 'Error saving file'})
    except Exception as e:
        print(f"File upload error: {e}")
        emit('file_response', {'status': 'error', 'message': 'Error uploading file'})

@socketio.on('typing')
def handle_typing(data):
    if request.sid not in active_users:
        return
    is_typing = data.get('is_typing', False)
    username = active_users[request.sid]['username']
    
    if is_typing:
        typing_users[request.sid] = {
            'username': username,
            'timestamp': datetime.datetime.now()
        }
    else:
        if request.sid in typing_users:
            del typing_users[request.sid]
    
    update_typing_status()

@socketio.on('get_users')
def handle_get_users():
    emit('active_users', {'users': get_active_usernames()})

@socketio.on('message_seen')
def handle_message_seen(data):
    if request.sid not in active_users:
        return
    user = active_users[request.sid]
    message_id = data.get('message_id')
    if message_id:
        db.update_message_status(message_id, user['user_id'], 'seen')
        emit('message_status', {
            'message_id': message_id,
            'user_id': user['user_id'],
            'status': 'seen'
        }, broadcast=True)

def update_typing_status():
    now = datetime.datetime.now()
    for sid in list(typing_users.keys()):
        if (now - typing_users[sid]['timestamp']).total_seconds() > 3:
            del typing_users[sid]
    users_typing = [user['username'] for user in typing_users.values()]
    socketio.emit('typing_status', {'users': users_typing})

def get_active_usernames():
    return [user['username'] for user in active_users.values()]

def format_timestamp(timestamp):
    if isinstance(timestamp, str):
        return timestamp
    return timestamp.strftime('%Y-%m-%d %H:%M:%S')

if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', port=8000)
    show_threads_and_sockets()



