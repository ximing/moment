export function AlbumSkeleton() {
  return (
    <div aria-hidden="true" className="grid grid-cols-2 gap-3 min-[900px]:grid-cols-3 min-[1400px]:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => (
        <div
          key={i}
          data-skeleton-note
          className="h-40 rounded-surface-md bg-feedback-skeleton"
        />
      ))}
    </div>
  );
}
