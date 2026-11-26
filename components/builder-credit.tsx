export default function BuilderCredit({ tone = 'light' }: { tone?: 'light' | 'dark' }) {
  const colour = tone === 'dark' ? 'text-white/45 hover:text-gold' : 'text-slate-400 hover:text-navy';
  return (
    <a
      href="https://agentsplus.online"
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1.5 text-[10px] font-semibold transition ${colour}`}
    >
      <span aria-hidden className="h-1 w-1 rounded-full bg-gold" />
      Built by agentsplus.online
    </a>
  );
}
