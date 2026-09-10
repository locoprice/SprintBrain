interface LoadingBlockProps {
  /** What is being fetched, lowercase: "snippets", "prompts", "your spaces". */
  what: string;
}

/** The first-load placeholder for snippets, prompts and memory. */
export function LoadingBlock({ what }: LoadingBlockProps) {
  return (
    <div className="flex items-center justify-center py-24 text-sm text-ink-subtle" role="status">
      Loading {what}…
    </div>
  );
}
