export function Metric({ label, value, note }) {
  return (
    <div className="pin-card-tight p-3">
      <div className="text-[10px] ink-faded uppercase tracking-widest mb-1">{label}</div>
      <div className="font-display text-3xl ink leading-none">{value}</div>
      <div className="text-[10px] ink-faded mt-1.5 italic">{note}</div>
    </div>
  );
}
