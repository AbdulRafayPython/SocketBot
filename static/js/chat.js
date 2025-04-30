document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const loginContainer = document.getElementById('login-container');
    const chatContainer = document.getElementById('chat-container');
    const usernameInput = document.getElementById('username-input');
    const joinBtn = document.getElementById('join-btn');
    const loginError = document.getElementById('login-error');
    const currentUser = document.getElementById('current-user');
    const onlineCount = document.getElementById('online-count');
    const usersList = document.getElementById('users-list');
    const chatMessages = document.getElementById('chat-messages');
    const messageInput = document.getElementById('message-input');
    const sendBtn = document.getElementById('send-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const typingIndicator = document.getElementById('typing-indicator');
    
    let username = '';
    let socket = null;
    let typingTimeout = null;
    
    // Initialize Socket.IO connection
    function initializeSocket() {
        socket = io();
        
        // Socket event handlers
        socket.on('connect', () => {
            console.log('Connected to server');
        });
        
        socket.on('disconnect', () => {
            console.log('Disconnected from server');
            showLoginForm();
        });
        
        socket.on('registration_response', (data) => {
            if (data.status === 'success') {
                showChatInterface(data.username);
                updateActiveUsers(data.active_users);
                
                // Display chat history
                if (data.recent_messages && data.recent_messages.length > 0) {
                    data.recent_messages.forEach(msg => {
                        addMessage(msg.username, msg.message, msg.created_at);
                    });
                    
                    // Scroll to bottom of chat
                    scrollToBottom();
                } else {
                    // If no messages, show welcome message
                    addSystemMessage('Welcome to SocketBot! Start chatting by typing a message below.');
                }
            }
        });
        
        socket.on('user_status', (data) => {
            updateActiveUsers(data.active_users);
            
            // Show system message for user joining/leaving
            if (data.status === 'online') {
                addSystemMessage(`${data.username} has joined the chat`);
            } else if (data.status === 'offline') {
                addSystemMessage(`${data.username} has left the chat`);
            }
        });
        
        socket.on('new_message', (data) => {
            addMessage(data.username, data.message, data.timestamp);
            scrollToBottom();
        });
        
        socket.on('typing_status', (data) => {
            updateTypingIndicator(data);
        });
    }
    
    // Register user with the server
    function registerUser() {
        username = usernameInput.value.trim();
        
        if (!username) {
            loginError.textContent = 'Please enter a username';
            return;
        }
        
        if (username.length < 3 || username.length > 20) {
            loginError.textContent = 'Username must be between 3 and 20 characters';
            return;
        }
        
        loginError.textContent = '';
        initializeSocket();
        
        // Register with the server
        socket.emit('register', { username });
    }
    
    // Show chat interface and hide login form
    function showChatInterface(user) {
        username = user;
        loginContainer.style.display = 'none';
        chatContainer.style.display = 'grid';
        currentUser.textContent = username;
        messageInput.focus();
    }
    
    // Show login form and hide chat interface
    function showLoginForm() {
        chatContainer.style.display = 'none';
        loginContainer.style.display = 'flex';
        usernameInput.value = '';
        usernameInput.focus();
        
        // Clear chat messages
        chatMessages.innerHTML = '';
        
        // Disconnect socket if connected
        if (socket) {
            socket.disconnect();
            socket = null;
        }
    }
    
    // Add a message to the chat window
    function addMessage(sender, text, timestamp) {
        const messageElement = document.createElement('div');
        messageElement.classList.add('message');
        
        // Add appropriate class based on sender
        if (sender === username) {
            messageElement.classList.add('sent');
        } else {
            messageElement.classList.add('received');
        }
        
        // Create message content
        messageElement.innerHTML = `
            <div class="message-header">
                <span class="message-sender">${sender}</span>
                <span class="message-time">${timestamp}</span>
            </div>
            <div class="message-content">${escapeHtml(text)}</div>
        `;
        
        chatMessages.appendChild(messageElement);
    }
    
    // Add a system message to the chat window
    function addSystemMessage(text) {
        const systemMessage = document.createElement('div');
        systemMessage.classList.add('system-message');
        systemMessage.textContent = text;
        chatMessages.appendChild(systemMessage);
        scrollToBottom();
    }
    
    // Update the list of active users
    function updateActiveUsers(users) {
        usersList.innerHTML = '';
        
        users.forEach(user => {
            const userItem = document.createElement('li');
            userItem.innerHTML = `
                <div class="user-status status-online"></div>
                <span>${user}</span>
            `;
            usersList.appendChild(userItem);
        });
        
        // Update online count
        onlineCount.textContent = `${users.length} online`;
    }
    
    // Send a message to the server
    function sendMessage() {
        const message = messageInput.value.trim();
        
        if (message && socket) {
            socket.emit('chat_message', { message });
            messageInput.value = '';
            
            // Stop typing indicator
            socket.emit('typing', { is_typing: false });
            clearTimeout(typingTimeout);
        }
    }
    
    // Update typing indicator based on data from server
    function updateTypingIndicator(data) {
        if (data.is_typing) {
            typingIndicator.textContent = `${data.username} is typing...`;
        } else {
            typingIndicator.textContent = '';
        }
    }
    
    // Scroll to the bottom of the chat messages
    function scrollToBottom() {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Escape HTML to prevent XSS
    function escapeHtml(text) {
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return text.replace(/[&<>"']/g, m => map[m]);
    }
    
    // Event Listeners
    joinBtn.addEventListener('click', registerUser);
    
    usernameInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            registerUser();
        }
    });
    
    sendBtn.addEventListener('click', sendMessage);
    
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });
    
    // Typing indicator logic
    messageInput.addEventListener('input', () => {
        if (socket) {
            socket.emit('typing', { is_typing: true });
            
            // Clear previous timeout
            clearTimeout(typingTimeout);
            
            // Set new timeout to stop typing indicator after 2 seconds of inactivity
            typingTimeout = setTimeout(() => {
                socket.emit('typing', { is_typing: false });
            }, 2000);
        }
    });
    
    logoutBtn.addEventListener('click', () => {
        showLoginForm();
    });
    
    // Focus on username input when page loads
    usernameInput.focus();
});