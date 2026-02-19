function QualityControls({ currentQuality, onChangeQuality }) {
  const levels = [
    { key: 'auto', label: 'Auto' },
    { key: 'low', label: '480p' },
    { key: 'medium', label: '720p' },
    { key: 'high', label: '1080p' },
  ];

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <span className="text-text-muted text-xs uppercase tracking-wider font-medium">Quality</span>
      <div className="flex gap-1.5">
        {levels.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => onChangeQuality(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer
              ${currentQuality === key
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-surface-800 text-text-muted border border-border hover:text-text-secondary hover:bg-surface-700'
              }`}
          >
            {label}
          </button>
        ))}
      </div>
      <span className="text-text-muted/50 text-xs">Auto adapts to your network</span>
    </div>
  );
}

export default QualityControls;
