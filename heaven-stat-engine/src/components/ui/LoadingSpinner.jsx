export default function LoadingSpinner({ size = 'md', text = '' }) {
  const sz = size === 'sm' ? 'spinner-sm' : size === 'lg' ? 'spinner-lg' : 'spinner-md';
  return (
    <div className="spinner-wrap">
      <div className={`spinner ${sz}`} />
      {text && <p className="spinner-text">{text}</p>}
    </div>
  );
}
