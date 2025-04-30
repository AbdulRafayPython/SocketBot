import pymysql
from config import DB_CONFIG

class Database:
    def __init__(self):
        self.connection = None
        self.initialize_tables()
    
    def get_connection(self):
        """Get a new connection to the database"""
        if self.connection is None or not self.connection.open:
            self.connection = pymysql.connect(
                host=DB_CONFIG['host'],
                user=DB_CONFIG['user'],
                password=DB_CONFIG['password'],
                database=DB_CONFIG['database'],
                port=DB_CONFIG['port'],
                cursorclass=pymysql.cursors.DictCursor
            )
        return self.connection
    
    def initialize_tables(self):
        """Initialize the database tables if they don't exist"""
        connection = self.get_connection()
        try:
            with connection.cursor() as cursor:
                # Create socket_users table if it doesn't exist
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS socket_users (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        username VARCHAR(50) UNIQUE NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                
                # Create socket_messages table if it doesn't exist
                cursor.execute("""
                    CREATE TABLE IF NOT EXISTS socket_messages (
                        id INT AUTO_INCREMENT PRIMARY KEY,
                        user_id INT NOT NULL,
                        message TEXT NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        FOREIGN KEY (user_id) REFERENCES socket_users(id)
                    )
                """)
            connection.commit()
        except Exception as e:
            print(f"Error initializing tables: {e}")
        finally:
            connection.close()
            self.connection = None
    
    def save_user(self, username):
        """Save a new user or get existing user id"""
        connection = self.get_connection()
        try:
            with connection.cursor() as cursor:
                # Check if user exists
                cursor.execute("SELECT id FROM socket_users WHERE username = %s", (username,))
                user = cursor.fetchone()
                
                if user:
                    return user['id']
                
                # If not, create new user
                cursor.execute("INSERT INTO socket_users (username) VALUES (%s)", (username,))
                connection.commit()
                return cursor.lastrowid
        except Exception as e:
            print(f"Error saving user: {e}")
            return None
        finally:
            connection.close()
            self.connection = None
    
    def save_message(self, user_id, message):
        """Save a message to the database"""
        connection = self.get_connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute("INSERT INTO socket_messages (user_id, message) VALUES (%s, %s)", 
                              (user_id, message))
                connection.commit()
                
                # Get message with timestamp
                cursor.execute("""
                    SELECT m.id, m.message, m.created_at, u.username 
                    FROM socket_messages m 
                    JOIN socket_users u ON m.user_id = u.id 
                    WHERE m.id = LAST_INSERT_ID()
                """)
                return cursor.fetchone()
        except Exception as e:
            print(f"Error saving message: {e}")
            return None
        finally:
            connection.close()
            self.connection = None
    
    def get_recent_messages(self, limit=50):
        """Get recent socket_messages from the database"""
        connection = self.get_connection()
        try:
            with connection.cursor() as cursor:
                cursor.execute("""
                    SELECT m.id, m.message, m.created_at, u.username 
                    FROM socket_messages m 
                    JOIN socket_users u ON m.user_id = u.id 
                    ORDER BY m.created_at DESC 
                    LIMIT %s
                """, (limit,))
                return cursor.fetchall()
        except Exception as e:
            print(f"Error getting socket_messages: {e}")
            return []
        finally:
            connection.close()
            self.connection = None

# Singleton instance
db = Database()