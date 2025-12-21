import { useState } from 'react';
import './Chat.css';

function Chat({ messages, onSendMessage }) {
  const [inputMessage, setInputMessage] = useState('');

  const handleSend = () => {
    if (inputMessage.trim()) {
      onSendMessage(inputMessage);
      setInputMessage('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <h3>Chat</h3>
      </div>
      <div className="chat-messages">
        {messages.map((msg, index) => (
          <div key={index} className="chat-message">
            {msg.isSystem ? (
              <>
                <div className="chat-message-header">
                  <span className="chat-message-name system">{msg.name}</span>
                </div>
                <div className="chat-message-text system">{msg.message}</div>
              </>
            ) : (
              <>
                <div className="chat-message-header">
                  <span className="chat-message-name">{msg.name}</span>
                  <span className="chat-message-time">{formatTime(msg.timestamp)}</span>
                </div>
                <div className="chat-message-text">{msg.message}</div>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="chat-input">
        <input
          type="text"
          placeholder="Type a message..."
          value={inputMessage}
          onChange={(e) => setInputMessage(e.target.value)}
          onKeyPress={handleKeyPress}
        />
        <button className="btn btn-primary" onClick={handleSend}>
          Send
        </button>
      </div>
    </div>
  );
}

export default Chat;
