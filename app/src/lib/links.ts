/**
 * External resource destinations surfaced in the sidebar "Resources" group.
 *
 * Fill in a URL to activate a link. A `null` value renders the row as a
 * disabled "coming soon" entry (with an explanatory tooltip) instead of a
 * dead `#` link — keeping the UI honest until the real destination exists.
 */
export const RESOURCE_LINKS: Record<
  'investors' | 'bugs' | 'github' | 'status',
  string | null
> = {
  investors: 'https://form.jotform.com/locoprice/investors',
  bugs: 'https://form.jotform.com/locoprice/accuracy',
  github: 'https://github.com/locoprice/SprintBrain/issues',
  status: null,
};
