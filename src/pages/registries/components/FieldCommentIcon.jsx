export default function FieldCommentIcon({ kind = "all" }) {
  const paths = {
    all: <><path d="M5 4h14v11H9l-4 4V4Z" /><path d="M8 8h8M8 11h5" /></>,
    text: <><path d="M4 6h16M4 10h16M4 14h16M4 18h10" /></>,
    photo: <><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8" cy="8" r="1.5" /><path d="m4 18 6-6 4 4 3-3 4 4" /></>,
    voice: <><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M9 22h6" /></>,
    video: <><rect x="2" y="5" width="13" height="14" rx="2" /><path d="m15 10 7-4v12l-7-4Z" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[kind] || paths.all}</svg>;
}
