import pymysql
import time
import logging
from config import DB_CONFIG

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('database.log')
    ]
)
logger = logging.getLogger(__name__)

class Database:
    def __init__(self, max_retries=3, retry_delay=1):
        self.connection = None
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.initialize_tables()
    
    def get_connection(self):
        """Get a new connection to the database with retry mechanism"""
        retries = 0
        while retries < self.max_retries:
            try:
                if self.connection is None or not self.connection.open:
                    self.connection = pymysql.connect(
                        host=DB_CONFIG['host'],
                        user=DB_CONFIG['user'],
                        password=DB_CONFIG['password'],
                        database=DB_CONFIG['database'],
                        port=DB_CONFIG['port'],
                        cursorclass=pymysql.cursors.DictCursor,
                        charset='utf8mb4',
                        connect_timeout=10,
                        read_timeout=30,
                        write_timeout=30,
                        autocommit=True
                    )
                    logger.info("Database connection established with server timezone +05:00")
                return self.connection
            except pymysql.Error as e:
                retries += 1
                logger.error(f"Connection attempt {retries} failed: {e}")
                if retries < self.max_retries:
                    time.sleep(self.retry_delay)
                else:
                    logger.critical(f"Failed to connect to database after {self.max_retries} attempts")
                    raise
            except Exception as e:
                logger.error(f"Unexpected error during connection: {e}")
                raise
    
    def close_connection(self, connection=None):
        """Safely close the database connection"""
        conn_to_close = connection or self.connection
        try:
            if conn_to_close and conn_to_close.open:
                conn_to_close.close()
                logger.info("Database connection closed")
        except pymysql.Error as e:
            logger.error(f"Error closing connection: {e}")
        finally:
            if conn_to_close == self.connection:
                self.connection = None
    
    def initialize_tables(self):
        """Initialize the database tables if they don't exist"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                # Create socket_users table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS socket_users (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        username VARCHAR(50) UNIQUE NOT NULL,
                        status ENUM('online', 'offline') DEFAULT 'offline',
                        avatar VARCHAR(255) DEFAULT NULL,
                        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                """)
                
                # Create socket_messages table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS socket_messages (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        message TEXT NOT NULL,
                        message_type ENUM('text', 'image', 'voice', 'system') DEFAULT 'text',
                        file_path VARCHAR(255) DEFAULT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES socket_users(id)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                """)
                
                # Create socket_user_sessions table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS socket_user_sessions (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        socket_id VARCHAR(100) NOT NULL,
                        ip_address VARCHAR(45) DEFAULT NULL,
                        user_agent TEXT DEFAULT NULL,
                        connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES socket_users(id)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                """)
                
                # Create socket_message_status table
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS socket_message_status (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        message_id INT NOT NULL,
                        user_id INT NOT NULL,
                        status ENUM('delivered', 'seen') NOT NULL,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (message_id) REFERENCES socket_messages(id),
                        FOREIGN KEY (user_id) REFERENCES socket_users(id)
                    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
                """)
                logger.info("Database tables initialized successfully")
        except pymysql.Error as e:
            logger.error(f"Error initializing tables: {e}")
        except Exception as e:
            logger.error(f"Unexpected error during table initialization: {e}")
        finally:
            self.close_connection(connection)
    
    def save_user(self, username):
        """Save a new user or get existing user id"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("SELECT id FROM socket_users WHERE username = %s", (username,))
                user = cursor.fetchone()
                
                if user:
                    cursor.execute("""
                        UPDATE socket_users 
                        SET status = 'online', last_seen = CURRENT_TIMESTAMP 
                        WHERE id = %s
                    """, (user['id'],))
                    logger.info(f"User {username} status updated to online")
                    return user['id']
                
                cursor.execute("""
                    INSERT INTO socket_users (username, status, created_at) 
                    VALUES (%s, 'online', CURRENT_TIMESTAMP)
                """, (username,))
                user_id = cursor.lastrowid
                logger.info(f"New user {username} created with ID {user_id}")
                return user_id
        except pymysql.Error as e:
            logger.error(f"Error saving user {username}: {e}")
            return None
        finally:
            self.close_connection(connection)
    
    def save_message(self, user_id, message, message_type='text', file_path=None):
        """Save a message to the database"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO socket_messages (user_id, message, message_type, file_path, created_at) 
                    VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP)
                """, (user_id, message, message_type, file_path))
                
                cursor.execute("""
                    SELECT m.id, m.message, m.message_type, m.file_path, m.created_at, u.username 
                    FROM socket_messages m 
                    JOIN socket_users u ON m.user_id = u.id 
                    WHERE m.id = LAST_INSERT_ID()
                """)
                message_data = cursor.fetchone()
                logger.info(f"Message saved: ID {message_data['id']}, Type {message_type}, User ID {user_id}")
                return message_data
        except pymysql.Error as e:
            logger.error(f"Error saving message for user ID {user_id}: {e}")
            return None
        finally:
            self.close_connection(connection)
    
    def get_recent_messages(self, limit=50):
        """Get recent messages from the database"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT m.id, m.message, m.message_type, m.file_path, m.created_at, u.username 
                    FROM socket_messages m 
                    JOIN socket_users u ON m.user_id = u.id 
                    ORDER BY m.created_at DESC 
                    LIMIT %s
                """, (limit,))
                messages = cursor.fetchall()
                logger.info(f"Retrieved {len(messages)} recent messages")
                return list(reversed(messages)) if messages else []
        except pymysql.Error as e:
            logger.error(f"Error getting recent messages: {e}")
            return []
        finally:
            self.close_connection(connection)
    
    def set_user_status(self, user_id, status='offline'):
        """Update user status in the database"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    UPDATE socket_users 
                    SET status = %s, last_seen = CURRENT_TIMESTAMP 
                    WHERE id = %s
                """, (status, user_id))
                logger.info(f"User ID {user_id} status updated to {status}")
                return True
        except pymysql.Error as e:
            logger.error(f"Error updating status for user ID {user_id}: {e}")
            return False
        finally:
            self.close_connection(connection)
    
    def get_active_users(self):
        """Get all active users from the database"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT id, username, avatar, last_seen
                    FROM socket_users 
                    WHERE status = 'online'
                    ORDER BY username
                """)
                users = cursor.fetchall()
                logger.info(f"Retrieved {len(users)} active users")
                return users
        except pymysql.Error as e:
            logger.error(f"Error getting active users: {e}")
            return []
        finally:
            self.close_connection(connection)
    
    def save_user_session(self, user_id, socket_id, ip_address=None, user_agent=None):
        """Save user session information"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO socket_user_sessions 
                    (user_id, socket_id, ip_address, user_agent, connected_at, last_active) 
                    VALUES (%s, %s, %s, %s, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, (user_id, socket_id, ip_address, user_agent))
                session_id = cursor.lastrowid
                logger.info(f"Session saved for user ID {user_id}, Socket ID {socket_id}")
                return session_id
        except pymysql.Error as e:
            logger.error(f"Error saving session for user ID {user_id}: {e}")
            return None
        finally:
            self.close_connection(connection)
    
    def update_user_session(self, socket_id):
        """Update user session last active timestamp"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    UPDATE socket_user_sessions 
                    SET last_active = CURRENT_TIMESTAMP 
                    WHERE socket_id = %s
                """, (socket_id,))
                logger.info(f"Session updated for Socket ID {socket_id}")
                return True
        except pymysql.Error as e:
            logger.error(f"Error updating session for Socket ID {socket_id}: {e}")
            return False
        finally:
            self.close_connection(connection)
    
    def get_user_by_socket_id(self, socket_id):
        """Get user information by socket ID"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT u.id, u.username, u.status, u.avatar 
                    FROM socket_users u
                    JOIN socket_user_sessions s ON u.id = s.user_id
                    WHERE s.socket_id = %s
                """, (socket_id,))
                user = cursor.fetchone()
                logger.info(f"Retrieved user for Socket ID {socket_id}: {user['username'] if user else 'None'}")
                return user
        except pymysql.Error as e:
            logger.error(f"Error getting user by Socket ID {socket_id}: {e}")
            return None
        finally:
            self.close_connection(connection)
    
    def update_message_status(self, message_id, user_id, status):
        """Update message status (delivered/seen) for a user"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT id FROM socket_message_status 
                    WHERE message_id = %s AND user_id = %s
                """, (message_id, user_id))
                existing = cursor.fetchone()
                
                if existing:
                    cursor.execute("""
                        UPDATE socket_message_status 
                        SET status = %s, updated_at = CURRENT_TIMESTAMP 
                        WHERE message_id = %s AND user_id = %s
                    """, (status, message_id, user_id))
                else:
                    cursor.execute("""
                        INSERT INTO socket_message_status (message_id, user_id, status, updated_at) 
                        VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                    """, (message_id, user_id, status))
                logger.info(f"Message {message_id} status updated to {status} for user {user_id}")
                return True
        except pymysql.Error as e:
            logger.error(f"Error updating message status for message {message_id}, user {user_id}: {e}")
            return False
        finally:
            self.close_connection(connection)
    
    def get_message_status(self, message_id):
        """Get status for a message"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT user_id, status 
                    FROM socket_message_status 
                    WHERE message_id = %s
                """, (message_id,))
                statuses = cursor.fetchall()
                logger.info(f"Retrieved status for message {message_id}")
                return statuses
        except pymysql.Error as e:
            logger.error(f"Error getting status for message {message_id}: {e}")
            return []
        finally:
            self.close_connection(connection)

# Singleton instance
db = Database()