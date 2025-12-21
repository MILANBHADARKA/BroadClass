import { useState } from 'react';
import './Lobby.css';

function Lobby({ onCreateRoom, onJoinRoom }) {
  const [username, setUsername] = useState('');
  const [roomId, setRoomId] = useState('');

  const handleCreateRoom = () => {
    if (!username.trim()) {
      alert('Please enter your name');
      return;
    }
    onCreateRoom(username);
  };

  const handleJoinRoom = () => {
    if (!username.trim()) {
      alert('Please enter your name');
      return;
    }
    if (!roomId.trim()) {
      alert('Please enter a room ID');
      return;
    }
    onJoinRoom(roomId, username);
  };

  return (
    <div className="lobby">
      <div className="container">
        <h1>Video Call Application</h1>
        <div className="form-section">
          <h2>Join or Create a Room</h2>
          <div className="form-group">
            <label htmlFor="username">Your Name:</label>
            <input
              type="text"
              id="username"
              placeholder="Enter your name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="button-group">
            <button className="btn btn-primary" onClick={handleCreateRoom}>
              Create Room (Instructor)
            </button>
          </div>
          <div className="separator">OR</div>
          <div className="form-group">
            <label htmlFor="roomId">Room ID:</label>
            <input
              type="text"
              id="roomId"
              placeholder="Enter room ID to join"
              value={roomId}
              onChange={(e) => setRoomId(e.target.value)}
            />
          </div>
          <button className="btn btn-secondary" onClick={handleJoinRoom}>
            Join Room (Student)
          </button>
        </div>
      </div>
    </div>
  );
}

export default Lobby;
