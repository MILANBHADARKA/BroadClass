import './QualityControls.css';

function QualityControls({ currentQuality, onChangeQuality }) {
  const levels = [
    { key: 'auto', label: 'Auto' },
    { key: 'low', label: 'Low (480p)' },
    { key: 'medium', label: 'Medium (720p)' },
    { key: 'high', label: 'High (1080p)' },
  ];

  return (
    <div className="quality-controls">
      <label>Video Quality:</label>
      <div className="quality-buttons">
        {levels.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onChangeQuality(key)}
            className={`btn btn-quality ${currentQuality === key ? 'active' : ''}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="quality-hint">
        Auto mode adapts quality based on your network speed
      </p>
    </div>
  );
}

export default QualityControls;
