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
  status: 'https://sprintbrain.instatus.com/',
};

/**
 * The support form, opened from the footer rather than the sidebar, which is
 * why it sits beside RESOURCE_LINKS instead of inside it. Both are framed by
 * `JotFormModal`; neither opens a tab.
 */
export const SUPPORT_FORM_URL = 'https://form.jotform.com/32942454514858';
