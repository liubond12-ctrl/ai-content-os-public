const paths={
  hot:"M4 20V5h16v15z M7 8h10 M7 12h4v4H7z M14 12h3 M14 16h3",
  home:"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  doc:"M5 3h10l4 4v14H5z M14 3v5h5 M8 12h8 M8 16h6",
  book:"M3 5h6q3 0 3 2q0-2 3-2h6v14h-6q-3 0-3 2q0-2-3-2H3z M12 7v14",
  settings:"M3 7h5m5 0h8 M3 17h10m5 0h3 M8 4h5v6H8z M13 14h5v6h-5z",
  search:"M16 16l5 5 M18 10a8 8 0 1 1-16 0a8 8 0 1 1 16 0"
};
export function Icon({type}:{type:keyof typeof paths}){
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round"><path d={paths[type]}/></svg>;
}
