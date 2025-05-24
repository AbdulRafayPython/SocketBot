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
    const showConferenceBtn = document.getElementById('show-conference-btn');
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
    let localStream = null;
    let peerConnections = {};
    let isInConference = false;
    let userIdToUsername = {};
    let activeConferences = new Map(); // Track active conferences by initiator_sid

    // Emoji Picker
    const emojiPicker = document.createElement('emoji-picker');
    emojiPicker.classList.add('emoji-picker');
    emojiPicker.style.display = 'none';
    emojiPicker.style.zIndex = '1000';
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
            if (isInConference) {
                stopConference();
            }
            showLoginForm();
        });

        socket.on('connection_response', (data) => {
            console.log(`Connection status: ${data.status}, Socket ID: ${data.socket_id}`);
        });

        socket.on('registration_response', (data) => {
            if (data.status === 'success') {
                username = data.username;
                userId = data.user_id;
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
            console.log('New message:', data);
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

        socket.on('conference_users', (data) => {
            console.log('Conference users:', data.users);
        });

        socket.on('join_conference', (data) => {
            if (isInConference && data.sid !== socket.id) {
                initiatePeerConnection(data.sid, data.username);
            }
        });

        socket.on('leave_conference', (data) => {
            if (peerConnections[data.sid]) {
                peerConnections[data.sid].close();
                delete peerConnections[data.sid];
                const videoStream = document.getElementById(`video-${data.sid}`);
                if (videoStream) {
                    videoStream.remove();
                    updateVideoStreamsLayout();
                }
            }
        });

        socket.on('video_offer', (data) => {
            handleVideoOffer(data.from_sid, data.offer, data.username);
        });

        socket.on('video_answer', (data) => {
            handleVideoAnswer(data.from_sid, data.answer);
        });

        socket.on('ice_candidate', (data) => {
            handleIceCandidate(data.from_sid, data.candidate);
        });

        socket.on('conference_status', (data) => {
            const { username: confUsername, action, initiator_sid } = data;
            if (action === 'started') {
                activeConferences.set(initiator_sid, confUsername);
                const message = `${confUsername} has started a video conference`;
                addSystemMessageWithJoinButton(message, initiator_sid);
            } else if (action === 'ended') {
                activeConferences.delete(initiator_sid);
                const message = `${confUsername} has ended a video conference`;
                addSystemMessage(message);
                const joinBtn = document.querySelector(`.join-conference-btn[data-initiator-sid="${initiator_sid}"]`);
                if (joinBtn) {
                    joinBtn.disabled = true;
                    joinBtn.innerHTML = '<i class="fas fa-video-slash"></i> Conference Ended';
                }
            }
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
        const videoConference = document.getElementById('video-conference');
        if (videoConference) {
            videoConference.remove();
        }
        username = '';
        userId = null;
        activeConferences.clear();
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
        console.log('Rendering message:', data);
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
            console.log('Image file_path:', data.file_path);
            const img = document.createElement('img');
            img.src = `/uploads/${data.file_path}`;
            img.className = 'message-image';
            img.alt = 'Uploaded image';
            img.onerror = () => {
                console.error('Image failed to load:', img.src);
                bubbleDiv.textContent = 'Error loading image';
            };
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
                const duration = audio.duration;
                if (isNaN(duration) || duration === Infinity) {
                    console.warn('Invalid audio duration:', duration);
                    durationSpan.textContent = '0:00';
                } else {
                    durationSpan.textContent = formatDuration(duration);
                }
            });

            audio.addEventListener('error', (e) => {
                console.error('Error loading audio:', e);
                durationSpan.textContent = 'Error';
                playBtn.disabled = true;
                playBtn.innerHTML = '<i class="fas fa-exclamation-triangle"></i>';
            });

            playBtn.addEventListener('click', () => {
                if (audio.paused) {
                    audio.play().catch((e) => {
                        console.error('Error playing audio:', e);
                        showNotification('error', 'Audio Playback', 'Unable to play audio');
                    });
                    playBtn.innerHTML = '<i class="fas fa-pause"></i>';
                } else {
                    audio.pause();
                    playBtn.innerHTML = '<i class="fas fa-play"></i>';
                }
            });

            audio.addEventListener('timeupdate', () => {
                const duration = audio.duration;
                const currentTime = audio.currentTime;
                if (isNaN(duration) || duration === Infinity) {
                    progressBar.style.width = '0%';
                    durationSpan.textContent = '0:00';
                } else {
                    const progress = (currentTime / duration) * 100;
                    progressBar.style.width = `${progress}%`;
                    durationSpan.textContent = `${formatDuration(currentTime)} / ${formatDuration(duration)}`;
                }
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
        } else {
            console.warn('Unknown message_type:', data.message_type);
            bubbleDiv.textContent = escapeHtml(data.message || 'Unsupported message type');
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

    // Add a system message with a "Join Conference" button
    function addSystemMessageWithJoinButton(text, initiatorSid) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', 'message-system');
        const bubbleDiv = document.createElement('div');
        bubbleDiv.className = 'message-bubble';
        bubbleDiv.innerHTML = `
            ${escapeHtml(text)}
            <button class="join-conference-btn hover-glow" data-initiator-sid="${initiatorSid}">
                <i class="fas fa-video"></i> Join Conference
            </button>
        `;
        messageElement.appendChild(bubbleDiv);
        chatMessages.appendChild(messageElement);
        scrollToBottom();

        // Add event listener to the join button
        const joinBtn = bubbleDiv.querySelector('.join-conference-btn');
        joinBtn.addEventListener('click', () => {
            if (activeConferences.has(initiatorSid)) {
                joinConference(initiatorSid);
            } else {
                showNotification('info', 'Conference Ended', 'This conference has ended.');
                joinBtn.disabled = true;
                joinBtn.innerHTML = '<i class="fas fa-video-slash"></i> Conference Ended';
            }
        });
    }

    // Update active users list
    function updateActiveUsers(users) {
        usersList.innerHTML = '';
        userIdToUsername = users;
        Object.values(users).forEach(user => {
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
        onlineCount.textContent = `${Object.keys(users).length} online`;
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
        if (isNaN(seconds) || seconds === Infinity || seconds <= 0) {
            return '0:00';
        }
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
                console.log('Uploading image');
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
                mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
                audioChunks = [];

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data.size > 0) {
                        audioChunks.push(e.data);
                    }
                };

                mediaRecorder.onstop = () => {
                    const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                    const reader = new FileReader();
                    reader.onload = () => {
                        socket.emit('upload_file', {
                            file: reader.result,
                            type: 'voice'
                        });
                    };
                    reader.readAsDataURL(audioBlob);
                    stream.getTracks().forEach(track => track.stop());
                    audioChunks = [];
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

    // WebRTC Video Conference
    function createVideoConferenceUI() {
        const videoConference = document.createElement('div');
        videoConference.className = 'video-conference';
        videoConference.id = 'video-conference';
        videoConference.innerHTML = `
            <div class="video-header glassmorphism">
                <div class="video-title">
                    <i class="fas fa-video video-title-icon"></i>
                    <span class="video-title-text">Video Conference</span>
                    <span class="participant-count" id="participant-count">1 participant</span>
                </div>
                <button class="video-close-btn hover-glow" id="close-conference-btn"><i class="fas fa-times"></i></button>
            </div>
            <div class="video-controls glassmorphism">
                <button id="start-conference-btn" class="hover-glow"><i class="fas fa-video"></i> Start Video Conference</button>
                <button id="stop-conference-btn" class="hover-glow" style="display: none;"><i class="fas fa-sign-out-alt"></i> Leave Conference</button>
                <button id="toggle-video-btn" class="hover-glow" style="display: none;"><i class="fas fa-video"></i> Video On</button>
                <button id="toggle-audio-btn" class="hover-glow" style="display: none;"><i class="fas fa-microphone"></i> Audio On</button>
                <button id="toggle-participants-btn" class="hover-glow" style="display: none;"><i class="fas fa-users"></i> Participants</button>
            </div>
            <div class="participants-list glassmorphism" id="participants-list" style="display: none;"></div>
            <div class="video-streams" id="video-streams"></div>
        `;
        chatContainer.appendChild(videoConference);

        document.getElementById('start-conference-btn').addEventListener('click', startConference);
        document.getElementById('stop-conference-btn').addEventListener('click', stopConference);
        document.getElementById('close-conference-btn').addEventListener('click', () => {
            stopConference();
            videoConference.remove();
        });

        // Add event listeners for new controls
        const toggleVideoBtn = document.getElementById('toggle-video-btn');
        const toggleAudioBtn = document.getElementById('toggle-audio-btn');
        const toggleParticipantsBtn = document.getElementById('toggle-participants-btn');
        const participantsList = document.getElementById('participants-list');

        toggleVideoBtn.addEventListener('click', toggleVideo);
        toggleAudioBtn.addEventListener('click', toggleAudio);
        toggleParticipantsBtn.addEventListener('click', () => {
            participantsList.style.display = participantsList.style.display === 'none' ? 'block' : 'none';
        });

        return videoConference;
    }

    showConferenceBtn.addEventListener('click', () => {
        let videoConference = document.getElementById('video-conference');
        if (!videoConference) {
            videoConference = createVideoConferenceUI();
        }
        videoConference.style.display = 'flex';
    });

    function updateVideoStreamsLayout() {
        const videoStreams = document.getElementById('video-streams');
        if (!videoStreams) return;

        const streamCount = videoStreams.children.length;
        const isMobile = window.innerWidth <= 768;

        videoStreams.className = 'video-streams';
        if (isMobile) {
            if (streamCount <= 2) {
                videoStreams.classList.add('grid-mobile-2');
            } else {
                videoStreams.classList.add('grid-mobile-1');
            }
        } else {
            if (streamCount === 1) videoStreams.classList.add('grid-1');
            else if (streamCount === 2) videoStreams.classList.add('grid-2');
            else if (streamCount <= 4) videoStreams.classList.add('grid-4');
            else if (streamCount <= 6) videoStreams.classList.add('grid-6');
            else videoStreams.classList.add('grid-many');
        }

        const participantCount = document.getElementById('participant-count');
        if (participantCount) {
            participantCount.textContent = `${streamCount} participant${streamCount !== 1 ? 's' : ''}`;
        }

        // Update participants list
        const participantsList = document.getElementById('participants-list');
        if (participantsList) {
            participantsList.innerHTML = '';
            const localParticipant = document.createElement('div');
            localParticipant.className = 'participant-item';
            localParticipant.innerHTML = `
                <span>${escapeHtml(username)} (You)</span>
                <i class="fas fa-user participant-icon"></i>
            `;
            participantsList.appendChild(localParticipant);

            for (const [sid, pc] of Object.entries(peerConnections)) {
                const participant = document.createElement('div');
                participant.className = 'participant-item';
                const participantUsername = document.getElementById(`video-${sid}`)?.dataset.username || userIdToUsername[sid] || 'Unknown';
                participant.innerHTML = `
                    <span>${escapeHtml(participantUsername)}</span>
                    <i class="fas fa-user participant-icon"></i>
                `;
                participantsList.appendChild(participant);
            }
        }
    }

    async function startConference() {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            const videoStreams = document.getElementById('video-streams');
            const localVideoContainer = document.createElement('div');
            localVideoContainer.id = `video-${socket.id}`;
            localVideoContainer.className = 'video-stream';
            localVideoContainer.setAttribute('data-username', username);

            const localVideo = document.createElement('video');
            localVideo.srcObject = localStream;
            localVideo.muted = true;
            localVideo.autoplay = true;
            localVideoContainer.appendChild(localVideo);

            const avatar = document.createElement('div');
            avatar.className = 'user-avatar-video';
            avatar.textContent = username.charAt(0).toUpperCase();
            localVideoContainer.appendChild(avatar);

            videoStreams.appendChild(localVideoContainer);
            document.getElementById('start-conference-btn').style.display = 'none';
            document.getElementById('stop-conference-btn').style.display = 'inline-block';
            document.getElementById('toggle-video-btn').style.display = 'inline-block';
            document.getElementById('toggle-audio-btn').style.display = 'inline-block';
            document.getElementById('toggle-participants-btn').style.display = 'inline-block';
            isInConference = true;
            socket.emit('join_conference');
            updateVideoStreamsLayout();

            // Notify other users
            socket.emit('conference_status', { action: 'started', initiator_sid: socket.id, username: username });
        } catch (e) {
            console.error('Error starting conference:', e);
            showNotification('error', 'Conference Error', 'Unable to access camera or microphone');
        }
    }

    async function joinConference(initiatorSid) {
        if (isInConference) {
            showNotification('info', 'Already in Conference', 'You are already in a conference. Leave your current conference to join another.');
            return;
        }

        let videoConference = document.getElementById('video-conference');
        if (!videoConference) {
            videoConference = createVideoConferenceUI();
        }
        videoConference.style.display = 'flex';

        try {
            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            const videoStreams = document.getElementById('video-streams');
            const localVideoContainer = document.createElement('div');
            localVideoContainer.id = `video-${socket.id}`;
            localVideoContainer.className = 'video-stream';
            localVideoContainer.setAttribute('data-username', username);

            const localVideo = document.createElement('video');
            localVideo.srcObject = localStream;
            localVideo.muted = true;
            localVideo.autoplay = true;
            localVideoContainer.appendChild(localVideo);

            const avatar = document.createElement('div');
            avatar.className = 'user-avatar-video';
            avatar.textContent = username.charAt(0).toUpperCase();
            localVideoContainer.appendChild(avatar);

            videoStreams.appendChild(localVideoContainer);
            document.getElementById('start-conference-btn').style.display = 'none';
            document.getElementById('stop-conference-btn').style.display = 'inline-block';
            document.getElementById('toggle-video-btn').style.display = 'inline-block';
            document.getElementById('toggle-audio-btn').style.display = 'inline-block';
            document.getElementById('toggle-participants-btn').style.display = 'inline-block';
            isInConference = true;
            socket.emit('join_conference');
            updateVideoStreamsLayout();

            // Connect to the initiator
            const initiatorUsername = activeConferences.get(initiatorSid);
            if (initiatorUsername) {
                initiatePeerConnection(initiatorSid, initiatorUsername);
            }
        } catch (e) {
            console.error('Error joining conference:', e);
            showNotification('error', 'Conference Error', 'Unable to access camera or microphone');
        }
    }

    function stopConference() {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }
        Object.values(peerConnections).forEach(pc => pc.close());
        peerConnections = {};
        const videoStreams = document.getElementById('video-streams');
        if (videoStreams) {
            videoStreams.innerHTML = '';
        }
        const startBtn = document.getElementById('start-conference-btn');
        const stopBtn = document.getElementById('stop-conference-btn');
        const toggleVideoBtn = document.getElementById('toggle-video-btn');
        const toggleAudioBtn = document.getElementById('toggle-audio-btn');
        const toggleParticipantsBtn = document.getElementById('toggle-participants-btn');
        const participantsList = document.getElementById('participants-list');
        if (startBtn && stopBtn && toggleVideoBtn && toggleAudioBtn && toggleParticipantsBtn) {
            startBtn.style.display = 'inline-block';
            stopBtn.style.display = 'none';
            toggleVideoBtn.style.display = 'none';
            toggleAudioBtn.style.display = 'none';
            toggleParticipantsBtn.style.display = 'none';
            if (participantsList) {
                participantsList.style.display = 'none';
                participantsList.innerHTML = '';
            }
        }
        isInConference = false;
        socket.emit('leave_conference');
        socket.emit('conference_status', { action: 'ended', initiator_sid: socket.id, username: username });
        updateVideoStreamsLayout();
    }

    function toggleVideo() {
        if (!localStream) return;
        const videoTrack = localStream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.enabled = !videoTrack.enabled;
            const toggleVideoBtn = document.getElementById('toggle-video-btn');
            const localVideoContainer = document.getElementById(`video-${socket.id}`);
            const localVideo = localVideoContainer.querySelector('video');
            const avatar = localVideoContainer.querySelector('.user-avatar-video');
            toggleVideoBtn.innerHTML = videoTrack.enabled
                ? '<i class="fas fa-video"></i> Video On'
                : '<i class="fas fa-video-slash"></i> Video Off';
            if (!videoTrack.enabled) {
                localVideo.style.display = 'none';
                avatar.style.display = 'flex';
            } else {
                localVideo.style.display = 'block';
                avatar.style.display = 'none';
            }
        }
    }

    function toggleAudio() {
        if (!localStream) return;
        const audioTrack = localStream.getAudioTracks()[0];
        if (audioTrack) {
            audioTrack.enabled = !audioTrack.enabled;
            const toggleAudioBtn = document.getElementById('toggle-audio-btn');
            toggleAudioBtn.innerHTML = audioTrack.enabled
                ? '<i class="fas fa-microphone"></i> Audio On'
                : '<i class="fas fa-microphone-slash"></i> Audio Off';
        }
    }

    async function initiatePeerConnection(targetSid, targetUsername) {
    if (peerConnections[targetSid]) {
        console.log(`Peer connection for ${targetSid} already exists, skipping initiation`);
        return;
    }

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });
    peerConnections[targetSid] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        if (!document.getElementById(`video-${targetSid}`)) {
            const remoteVideoContainer = document.createElement('div');
            remoteVideoContainer.id = `video-${targetSid}`;
            remoteVideoContainer.className = 'video-stream';
            remoteVideoContainer.setAttribute('data-username', targetUsername);

            const remoteVideo = document.createElement('video');
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.autoplay = true;
            remoteVideoContainer.appendChild(remoteVideo);

            const avatar = document.createElement('div');
            avatar.className = 'user-avatar-video';
            avatar.textContent = targetUsername.charAt(0).toUpperCase();
            remoteVideoContainer.appendChild(avatar);

            document.getElementById('video-streams').appendChild(remoteVideoContainer);
            updateVideoStreamsLayout();

            const videoTrack = event.streams[0].getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.onmute = () => {
                    remoteVideo.style.display = 'none';
                    avatar.style.display = 'flex';
                };
                videoTrack.onunmute = () => {
                    remoteVideo.style.display = 'block';
                    avatar.style.display = 'none';
                };
            }
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                target_sid: targetSid,
                candidate: event.candidate
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`Peer connection state (${targetSid}): ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            pc.close();
            delete peerConnections[targetSid];
            const videoElement = document.getElementById(`video-${targetSid}`);
            if (videoElement) videoElement.remove();
            updateVideoStreamsLayout();
        }
    };

    try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit('video_offer', {
            target_sid: targetSid,
            offer: pc.localDescription,
            username: username
        });
    } catch (e) {
        console.error('Error creating offer:', e);
        pc.close();
        delete peerConnections[targetSid];
    }
}

    async function handleVideoOffer(fromSid, offer, username) {
    if (!isInConference) return;

    if (peerConnections[fromSid]) {
        console.log(`Existing peer connection for ${fromSid}, resetting it`);
        peerConnections[fromSid].close();
        delete peerConnections[fromSid];
    }

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' }
        ]
    });
    peerConnections[fromSid] = pc;

    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    pc.ontrack = (event) => {
        if (!document.getElementById(`video-${fromSid}`)) {
            const remoteVideoContainer = document.createElement('div');
            remoteVideoContainer.id = `video-${fromSid}`;
            remoteVideoContainer.className = 'video-stream';
            remoteVideoContainer.setAttribute('data-username', username);

            const remoteVideo = document.createElement('video');
            remoteVideo.srcObject = event.streams[0];
            remoteVideo.autoplay = true;
            remoteVideoContainer.appendChild(remoteVideo);

            const avatar = document.createElement('div');
            avatar.className = 'user-avatar-video';
            avatar.textContent = username.charAt(0).toUpperCase();
            remoteVideoContainer.appendChild(avatar);

            document.getElementById('video-streams').appendChild(remoteVideoContainer);
            updateVideoStreamsLayout();

            const videoTrack = event.streams[0].getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.onmute = () => {
                    remoteVideo.style.display = 'none';
                    avatar.style.display = 'flex';
                };
                videoTrack.onunmute = () => {
                    remoteVideo.style.display = 'block';
                    avatar.style.display = 'none';
                };
            }
        }
    };

    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice_candidate', {
                target_sid: fromSid,
                candidate: event.candidate
            });
        }
    };

    pc.onconnectionstatechange = () => {
        console.log(`Peer connection state (${fromSid}): ${pc.connectionState}`);
        if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
            pc.close();
            delete peerConnections[fromSid];
            const videoElement = document.getElementById(`video-${fromSid}`);
            if (videoElement) videoElement.remove();
            updateVideoStreamsLayout();
        }
    };

    try {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit('video_answer', {
            target_sid: fromSid,
            answer: pc.localDescription,
            username: username
        });
    } catch (e) {
        console.error('Error handling offer:', e);
        pc.close();
        delete peerConnections[fromSid];
    }
}

    async function handleVideoAnswer(fromSid, answer) {
    const pc = peerConnections[fromSid];
    if (pc) {
        if (pc.signalingState !== 'have-local-offer') {
            console.warn(`Cannot handle answer for ${fromSid}, invalid signaling state: ${pc.signalingState}`);
            return;
        }
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (e) {
            console.error('Error handling answer:', e);
            pc.close();
            delete peerConnections[fromSid];
        }
    } else {
        console.warn(`No peer connection found for ${fromSid}`);
    }
}

    async function handleIceCandidate(fromSid, candidate) {
        const pc = peerConnections[fromSid];
        if (pc) {
            try {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
                console.error('Error adding ICE candidate:', e);
            }
        }
    }

    // Emoji Picker Handling
    function positionEmojiPicker() {
        const rect = emojiBtn.getBoundingClientRect();
        const pickerHeight = 320;
        const pickerWidth = 300;
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        if (viewportWidth <= 768) {
            emojiPicker.style.position = 'fixed';
            emojiPicker.style.bottom = '80px';
            emojiPicker.style.left = '50%';
            emojiPicker.style.transform = 'translateX(-50%)';
            emojiPicker.style.width = '90%';
            emojiPicker.style.maxWidth = '400px';
            emojiPicker.style.maxHeight = '220px';
            emojiPicker.style.overflowY = 'auto';
        } else {
            emojiPicker.style.position = 'absolute';
            const spaceAbove = rect.top;
            const spaceBelow = viewportHeight - rect.bottom;
            const top = spaceAbove >= pickerHeight ? rect.top - pickerHeight : rect.bottom + 5;
            emojiPicker.style.top = `${top}px`;
            const left = rect.left + (rect.width - pickerWidth) / 2;
            emojiPicker.style.left = `${Math.max(10, Math.min(left, viewportWidth - pickerWidth - 10))}px`;
            emojiPicker.style.width = `${pickerWidth}px`;
            emojiPicker.style.maxHeight = `${pickerHeight}px`;
            emojiPicker.style.overflowY = 'auto';
        }
    }

    emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        emojiPicker.style.display = emojiPicker.style.display === 'block' ? 'none' : 'block';
        if (emojiPicker.style.display === 'block') {
            positionEmojiPicker();
        }
    });

    document.addEventListener('click', (e) => {
        if (
            !emojiPicker.contains(e.target) &&
            e.target !== emojiBtn &&
            emojiPicker.style.display === 'block'
        ) {
            emojiPicker.style.display = 'none';
        }
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

    window.addEventListener('resize', () => {
        if (emojiPicker.style.display === 'block') {
            positionEmojiPicker();
        }
        updateVideoStreamsLayout(); // Update layout on resize
    });

    // Event Listeners
    joinBtn.addEventListener('click', () => {
        console.log('Join button clicked');
        registerUser();
    });

    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            console.log('Enter key pressed in username input');
            joinBtn.click();
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

    logoutBtn.addEventListener('click', showLoginForm);

    // Focus on username input
    usernameInput.focus();
});