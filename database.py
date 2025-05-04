import pymysql
import time
from config import DB_CONFIG

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
                        # Added connection pool configuration
                        charset='utf8mb4',
                        connect_timeout=10,
                        read_timeout=30,
                        write_timeout=30,
                        autocommit=True
                    )
                return self.connection
            except Exception as e:
                retries += 1
                print(f"Connection attempt {retries} failed: {e}")
                if retries < self.max_retries:
                    time.sleep(self.retry_delay)
                else:
                    raise
    
    def close_connection(self, connection=None):
        """Safely close the database connection"""
        conn_to_close = connection or self.connection
        try:
            if conn_to_close and conn_to_close.open:
                conn_to_close.close()
        except Exception as e:
            print(f"Error closing connection: {e}")
        finally:
            if conn_to_close == self.connection:
                self.connection = None
    
    def initialize_tables(self):
        """Initialize the database tables if they don't exist"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                # Create socket_users table if it doesn't exist
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS socket_users (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        username VARCHAR(50) UNIQUE NOT NULL,
                        status ENUM('online', 'offline') DEFAULT 'offline',
                        avatar VARCHAR(255) DEFAULT NULL,
                        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Create socket_messages table if it doesn't exist
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS socket_messages (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        message TEXT NOT NULL,
                        message_type ENUM('text', 'image', 'file', 'system') DEFAULT 'text',
                        is_read BOOLEAN DEFAULT FALSE,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES socket_users(id)
                    )
                """)
                
                # Create socket_user_sessions table for handling reconnections
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
                    )
                """)
        except Exception as e:
            print(f"Error initializing tables: {e}")
        finally:
            self.close_connection(connection)
    
    def save_user(self, username):
        """Save a new user or get existing user id"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                # Check if user exists
                cursor.execute("SELECT id FROM socket_users WHERE username = %s", (username,))
                user = cursor.fetchone()
                
                if user:
                    # Update user status to online
                    cursor.execute("""
                        UPDATE socket_users 
                        SET status = 'online', last_seen = CURRENT_TIMESTAMP 
                        WHERE id = %s
                    """, (user['id'],))
                    return user['id']
                
                # If not, create new user
                cursor.execute("""
                    INSERT INTO socket_users (username, status) 
                    VALUES (%s, 'online')
                """, (username,))
                return cursor.lastrowid
        except Exception as e:
            print(f"Error saving user: {e}")
            return None
        finally:
            self.close_connection(connection)
    
    def save_message(self, user_id, message, message_type='text'):
        """Save a message to the database"""
        connection = None
        try:
            connection = self.get_connection()
            with connection.cursor() as cursor:
                cursor.execute("""
                    INSERT INTO socket_messages (user_id, message, message_type) 
                    VALUES (%s, %s, %s)
                """, (user_id, message, message_type))
                
                # Get message with timestamp
                cursor.execute("""
                    SELECT m.id, m.message, m.message_type, m.created_at, u.username 
                    FROM socket_messages m 
                    JOIN socket_users u ON m.user_id = u.id 
                    WHERE m.id = LAST_INSERT_ID()
                """)
                return cursor.fetchone()
        except Exception as e:
            print(f"Error saving message: {e}")
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
                    SELECT m.id, m.message, m.message_type, m.created_at, u.username 
                    FROM socket_messages m 
                    JOIN socket_users u ON m.user_id = u.id 
                    ORDER BY m.created_at DESC 
                    LIMIT %s
                """, (limit,))
                messages = cursor.fetchall()
                # Return messages in chronological order
                return list(reversed(messages)) if messages else []
        except Exception as e:
            print(f"Error getting messages: {e}")
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
                return True
        except Exception as e:
            print(f"Error updating user status: {e}")
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
                return cursor.fetchall()
        except Exception as e:
            print(f"Error getting active users: {e}")
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
                    (user_id, socket_id, ip_address, user_agent) 
                    VALUES (%s, %s, %s, %s)
                """, (user_id, socket_id, ip_address, user_agent))
                return cursor.lastrowid
        except Exception as e:
            print(f"Error saving user session: {e}")
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
                return True
        except Exception as e:
            print(f"Error updating user session: {e}")
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
                return cursor.fetchone()
        except Exception as e:
            print(f"Error getting user by socket ID: {e}")
            return None
        finally:
            self.close_connection(connection)

# Singleton instance
db = Database()