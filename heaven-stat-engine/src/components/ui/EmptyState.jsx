export default function EmptyState({ icon: Icon, title, text, action }) {
  return (
    <div className="empty-state">
      {Icon && <Icon size={40} className="empty-state-icon" />}
      <h3 className="empty-state-title">{title}</h3>
      {text && <p className="empty-state-text">{text}</p>}
      {action && (
        <div className="empty-state-action">{action}</div>
      )}
    </div>
  );
}
