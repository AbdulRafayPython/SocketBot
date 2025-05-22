document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginContainer = document.getElementById('login-container');
    const chatContainer = document.getElementById('chat-container');
    const usernameInput = document.getElementById('username-input');
    const joinBtn = document.getElementById('join-btn');
    const loginError = document.getElementById('login-error');
    const currentUserSpan = document.getElementById('current-user');
    const userAvatar = document.getElementById('user-avatar');
    const onlineCount = document.getElementById('online-count');
    const usersList = document.getElementById('users-list');
    const chatMessages = document.getElementById('chat-messages');
    const emptyState = document.getElementById('empty-state');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const typingIndicator = document.getElementById('typing-indicator');
    const imageUpload = document.getElementById('image-upload');
    const emojiBtn = document.getElementById('emoji-btn');
    const voiceBtn = document.getElementById('voice-btn');
    const cameraBtn = document.getElementById('camera-btn');
    const connectionStatus = document.getElementById('connection-status');
    const connectionIndicator = connectionStatus.querySelector('.connection-indicator');
    const cameraVideo = document.getElementById('camera-video');
    const cameraCanvas = document.getElementById('camera-canvas');

    let username = '';
    let socket = null;
    let typingTimeout = null;
    let mediaRecorder = null;
    let audioChunks = [];
    let cameraStream = null;
    let userId = null;

    // Emoji Picker
    const emojiPicker = document.createElement('emoji-picker');
    emojiPicker.style.position = 'absolute';
    emojiPicker.style.display = 'none';
    document.body.appendChild(emojiPicker);

    // Camera Modal
    const cameraModal = document.createElement('div');
    cameraModal.className = 'camera-modal';
    cameraModal.innerHTML = `
        <div class="camera-preview glassmorphism">
            <video id="camera-preview-video" autoplay></video>
            <div class="camera-controls">
                <button class="camera-btn" id="capture-btn">Capture</button>
                <button class="camera-btn" id="cancel-camera-btn">Cancel</button>
            </div>
        </div>
    `;
    document.body.appendChild(cameraModal);

    // Particles Animation
    function createParticle() {
        const particle = document.createElement('div');
        particle.className = 'particle';
        const size = Math.random() * 5 + 2;
        particle.style.width = `${size}px`;
        particle.style.height = `${size}px`;
        particle.style.left = `${Math.random() * 100}%`;
        particle.style.animationDuration = `${Math.random() * 5 + 5}s`;
        document.getElementById('particles-container').appendChild(particle);
        setTimeout(() => particle.remove(), 10000);
    }
    setInterval(createParticle, 200);

    // Theme Toggle
    const modeToggle = document.getElementById('mode-toggle');
    modeToggle.addEventListener('click', () => {
        document.body.classList.toggle('light');
        modeToggle.classList.toggle('dark');
    });

    // Initialize Socket.IO connection
    function initializeSocket() {
        // socket = io('http://127.0.0.1:8000', { transports: ['websocket'] });
        socket = io('https://d450-223-123-112-226.ngrok-free.app', {
            transports: ['websocket']
        });


        socket.on('connect', () => {
            console.log('Connected to server');
            connectionStatus.querySelector('span').textContent = 'Connected';
            connectionIndicator.className = 'connection-indicator';
        });

        socket.on('connect_error', (error) => {
            console.error('Connection error:', error);
            connectionStatus.querySelector('span').textContent = 'Connection Failed';
            connectionIndicator.className = 'connection-indicator disconnected';
            showNotification('error', 'Connection Error', 'Unable to connect to server');
        });

        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            connectionStatus.querySelector('span').textContent = 'Disconnected';
            connectionIndicator.className = 'connection-indicator disconnected';
            showLoginForm();
        });

        socket.on('connection_response', (data) => {
            console.log(`Connection status: ${data.status}, Socket ID: ${data.socket_id}`);
        });

        socket.on('registration_response', (data) => {
            if (data.status === 'success') {
                username = data.username;
                userId = data.user_id; // Store user_id if provided by server
                showChatInterface(data.username);
                if (data.recent_messages && data.recent_messages.length > 0) {
                    emptyState.style.display = 'none';
                    data.recent_messages.forEach(renderMessage);
                    scrollToBottom();
                } else {
                    emptyState.style.display = 'flex';
                }
                socket.emit('get_users');
            } else {
                loginError.textContent = data.message;
            }
        });

        socket.on('user_status', (data) => {
            updateActiveUsers(data.active_users);
            addSystemMessage(`${data.username} has ${data.status === 'online' ? 'joined' : 'left'} the chat`);
        });

        socket.on('new_message', (data) => {
            emptyState.style.display = 'none';
            renderMessage(data);
            scrollToBottom();
            if (data.username !== username) {
                socket.emit('message_seen', { message_id: data.id });
            }
        });

        socket.on('typing_status', (data) => {
            updateTypingIndicator(data);
        });

        socket.on('file_response', (data) => {
            showNotification(data.status, 'File Upload', data.message);
        });

        socket.on('message_status', (data) => {
            updateMessageStatus(data.message_id, data.user_id, data.status);
        });
    }

    // Show chat interface and hide login form
    function showChatInterface(user) {
        username = user;
        loginContainer.style.display = 'none';
        chatContainer.style.display = 'grid';
        currentUserSpan.textContent = username;
        userAvatar.textContent = username[0].toUpperCase();
        messageInput.focus();
    }

    // Show login form and hide chat interface
    function showLoginForm() {
        chatContainer.style.display = 'none';
        loginContainer.style.display = 'flex';
        usernameInput.value = '';
        loginError.textContent = '';
        chatMessages.innerHTML = '';
        emptyState.style.display = 'flex';
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        username = '';
        userId = null;
    }

    // Register user with the server
    function registerUser() {
        const inputUsername = usernameInput.value.trim();
        if (!inputUsername) {
            loginError.textContent = 'Please enter a username';
            return;
        }
        if (inputUsername.length < 3 || inputUsername.length > 20) {
            loginError.textContent = 'Username must be between 3 and 20 characters';
            return;
        }
        console.log('Join button clicked, registering user:', inputUsername);
        loginError.textContent = '';
        initializeSocket();
        socket.emit('register', { username: inputUsername });
    }

    // Render a message
    function renderMessage(data) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        messageElement.classList.add(data.username === username ? 'message-sent' : 'message-received');
        messageElement.dataset.messageId = data.id;

        const headerDiv = document.createElement('div');
        headerDiv.className = 'message-header';
        headerDiv.innerHTML = `<span class="message-sender">${escapeHtml(data.username)}</span>`;

        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';

        if (data.message_type === 'text') {
            bubbleDiv.textContent = escapeHtml(data.message);
        } else if (data.message_type === 'image') {
            const img = document.createElement('img');
            img.src = `/uploads/${data.file_path}`;
            img.className = 'message-image';
            img.alt = 'Uploaded image';
            bubbleDiv.appendChild(img);
        } else if (data.message_type === 'voice') {
            const voiceDiv = document.createElement('div');
            voiceDiv.className = 'message-voice';
            voiceDiv.innerHTML = `
                <button class="voice-play-btn"><i class="fas fa-play"></i></button>
                <div class="voice-progress"><div class="voice-progress-bar"></div></div>
                <span class="voice-duration">0:00</span>
            `;
            const audio = new Audio(`/uploads/${data.file_path}`);
            const playBtn = voiceDiv.querySelector('.voice-play-btn');
            const progressBar = voiceDiv.querySelector('.voice-progress-bar');
            const durationSpan = voiceDiv.querySelector('.voice-duration');

            audio.addEventListener('loadedmetadata', () => {
                durationSpan.textContent = formatDuration(audio.duration);
            });

            playBtn.addEventListener('click', () => {
                if (audio.paused) {
                    audio.play();
                    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
                } else {
                    audio.pause();
                    playBtn.innerHTML = '<i class="fas fa-play"></i>';
                }
            });

            audio.addEventListener('timeupdate', () => {
                const progress = (audio.currentTime / audio.duration) * 100;
                progressBar.style.width = `${progress}%`;
                durationSpan.textContent = `${formatDuration(audio.currentTime)} / ${formatDuration(audio.duration)}`;
            });

            audio.addEventListener('ended', () => {
                playBtn.innerHTML = '<i class="fas fa-play"></i>';
                progressBar.style.width = '0%';
                audio.currentTime = 0;
            });

            bubbleDiv.appendChild(voiceDiv);
        } else if (data.message_type === 'system') {
            messageElement.classList.remove('message-sent', 'message-received');
            messageElement.classList.add('message-system');
            bubbleDiv.textContent = escapeHtml(data.message);
        }

        const timestampDiv = document.createElement('div');
        timestampDiv.className = 'message-timestamp';
        timestampDiv.textContent = formatTimestamp(data.timestamp);

        const statusDiv = document.createElement('div');
        statusDiv.className = 'message-status';
        updateMessageStatusDisplay(statusDiv, data.statuses || {});

        messageElement.appendChild(headerDiv);
        messageElement.appendChild(bubbleDiv);
        messageElement.appendChild(timestampDiv);
        messageElement.appendChild(statusDiv);
        chatMessages.appendChild(messageElement);
    }

    // Update message status display
    function updateMessageStatusDisplay(statusDiv, statuses) {
        if (!Object.keys(statuses).length) {
            statusDiv.innerHTML = '';
            return;
        }
        const hasSeen = Object.values(statuses).includes('seen');
        statusDiv.className = `message-status ${hasSeen ? 'seen' : 'delivered'}`;
        statusDiv.innerHTML = `
            <i class="fas ${hasSeen ? 'fa-check-double' : 'fa-check'}"></i>
            ${hasSeen ? 'Seen' : 'Delivered'}
        `;
    }

    // Update message status
    function updateMessageStatus(messageId, userId, status) {
        const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
        if (messageElement) {
            const statusDiv = messageElement.querySelector('.message-status');
            const currentStatuses = Array.from(messageElement.querySelectorAll('.message-status')).reduce((acc, div) => {
                const userId = div.dataset.userId;
                if (userId) acc[userId] = div.className.includes('seen') ? 'seen' : 'delivered';
                return acc;
            }, {});
            currentStatuses[userId] = status;
            updateMessageStatusDisplay(statusDiv, currentStatuses);
        }
    }

    // Add a system message
    function addSystemMessage(text) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'message-system');
        messageElement.innerHTML = `<div class="message-bubble">${escapeHtml(text)}</div>`;
        chatMessages.appendChild(messageElement);
        scrollToBottom();
    }

    // Update active users list
    function updateActiveUsers(users) {
        usersList.innerHTML = '';
        users.forEach(user => {
            const userItem = document.createElement('li');
            userItem.innerHTML = `
                <div class="user-item">
                    <div class="user-avatar-small">${escapeHtml(user[0].toUpperCase())}</div>
                    <span>${escapeHtml(user)}</span>
                    <div class="user-status online"></div>
                </div>
            `;
            usersList.appendChild(userItem);
        });
        onlineCount.textContent = `${users.length} online`;
    }

    // Send a text message
    function sendMessage() {
        const message = messageInput.value.trim();
        if (message && socket) {
            socket.emit('chat_message', { message, type: 'text' });
            messageInput.value = '';
            socket.emit('typing', { is_typing: false });
            clearTimeout(typingTimeout);
        }
    }

    // Update typing indicator
    function updateTypingIndicator(data) {
        if (data.users && data.users.length) {
            const usersTyping = data.users.filter(u => u !== username);
            if (usersTyping.length) {
                typingIndicator.innerHTML = `${escapeHtml(usersTyping.join(', '))} ${usersTyping.length > 1 ? 'are' : 'is'} typing<span class="typing-dots"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span></span>`;
            } else {
                typingIndicator.innerHTML = '';
            }
        } else {
            typingIndicator.innerHTML = '';
        }
    }

    // Scroll to bottom
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    // Escape HTML
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Format duration for voice messages
    function formatDuration(seconds) {
        const min = Math.floor(seconds / 60);
        const sec = Math.floor(seconds % 60);
        return `${min}:${sec.toString().padStart(2, '0')}`;
    }

    // Format timestamp
    function formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' });
    }

    // Show notification
    function showNotification(type, title, message) {
        const notification = document.createElement('div');
        notification.className = `notification ${type} show`;
        notification.innerHTML = `
            <i class="fas fa-${type === 'error' ? 'exclamation-circle' : 'check-circle'} notification-icon"></i>
            <div class="notification-content">
                <div class="notification-title">${escapeHtml(title)}</div>
                <div class="notification-message">${escapeHtml(message)}</div>
            </div>
            <i class="fas fa-times notification-close"></i>
        `;
        document.body.appendChild(notification);

        notification.querySelector('.notification-close').addEventListener('click', () => {
            notification.remove();
        });

        setTimeout(() => {
            notification.remove();
        }, 5000);
    }

    // Image Upload
    imageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                socket.emit('upload_file', {
                    file: reader.result,
                    type: 'image'
                });
            };
            reader.readAsDataURL(file);
            imageUpload.value = '';
        }
    });

    // Voice Recording
    voiceBtn.addEventListener('click', async () => {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            mediaRecorder.stop();
            voiceBtn.innerHTML = '<i class="fas fa-microphone"></i>';
        } else {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                mediaRecorder = new MediaRecorder(stream);
                audioChunks = [];

                mediaRecorder.ondataavailable = (e) => {
                    audioChunks.push(e.data);
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/mp3' });
                    const reader = new FileReader();
                    reader.onload = () => {
                        socket.emit('upload_file', {
                            file: reader.result,
                            type: 'voice'
                        });
                    };
                    reader.readAsDataURL(audioBlob);
                    stream.getTracks().forEach(track => track.stop());
                };

                mediaRecorder.start();
                voiceBtn.innerHTML = '<i class="fas fa-stop"></i>';
            } catch (e) {
                console.error('Error accessing microphone:', e);
                showNotification('error', 'Microphone Access', 'Unable to access microphone');
            }
        }
    });

    // Camera Capture
    cameraBtn.addEventListener('click', async () => {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
            const previewVideo = document.getElementById('camera-preview-video');
            previewVideo.srcObject = cameraStream;
            cameraModal.classList.add('active');
        } catch (e) {
            console.error('Error accessing camera:', e);
            showNotification('error', 'Camera Access', 'Unable to access camera');
        }
    });

    document.getElementById('capture-btn').addEventListener('click', () => {
        const video = document.getElementById('camera-preview-video');
        cameraCanvas.width = video.videoWidth;
        cameraCanvas.height = video.videoHeight;
        cameraCanvas.getContext('2d').drawImage(video, 0, 0);
        const dataUrl = cameraCanvas.toDataURL('image/png');
        socket.emit('upload_file', {
            file: dataUrl,
            type: 'image'
        });
        closeCamera();
    });

    document.getElementById('cancel-camera-btn').addEventListener('click', closeCamera);

    function closeCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            cameraStream = null;
        }
        cameraModal.classList.remove('active');
    }

    // Emoji Picker
    emojiBtn.addEventListener('click', () => {
        emojiPicker.style.display = emojiPicker.style.display === 'none' ? 'block' : 'none';
        emojiPicker.style.top = `${emojiBtn.offsetTop - 300}px`;
        emojiPicker.style.left = `${emojiBtn.offsetLeft}px`;
    });

    emojiPicker.addEventListener('emoji-click', (event) => {
        messageInput.value += event.detail.unicode;
        messageInput.focus();
        socket.emit('typing', { is_typing: true });
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            socket.emit('typing', { is_typing: false });
        }, 2000);
        emojiPicker.style.display = 'none';
    });

    // Event Listeners
    joinBtn.addEventListener('click', () => {
        console.log('Join button clicked');
        registerUser();
    });

    // Event Listener for Enter key on username input
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            console.log('Enter key pressed in username input');
            joinBtn.click(); // Triggers the same handler
        }
    });

    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendMessage();
    });

    messageInput.addEventListener('input', () => {
        if (socket) {
            socket.emit('typing', { is_typing: messageInput.value.trim().length > 0 });
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => {
                socket.emit('typing', { is_typing: false });
            }, 2000);
        }
    });

    if (window.innerWidth <= 768) {
        emojiPicker.style.position = 'fixed';
        emojiPicker.style.bottom = '70px';
        emojiPicker.style.left = '5%';
        emojiPicker.style.width = '90%';
        emojiPicker.style.maxHeight = '200px';
        emojiPicker.style.overflowY = 'auto';
    }

    logoutBtn.addEventListener('click', showLoginForm);

    // Focus on username input
    usernameInput.focus();
});