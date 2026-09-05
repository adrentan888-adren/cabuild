# UX improvement backlog

These are proposed follow-ups, not features shipped in the styling release. Priorities reflect the product requirements, current capability map and independent UX review.

| Priority | Improvement | Why it helps | Acceptance signal |
| --- | --- | --- | --- |
| 1 | Show an estimated CA credit cost beside each chargeable action | Makes the cost visible at the decision point, consistent with PRD CRT08 | Every generation action shows its estimate and any uncertainty before submission |
| 2 | Add one activity summary for running and failed jobs | Helps users return to asynchronous work and recover without searching through modules | Each job links to its output or editor and offers a safe retry when supported |
| 3 | Sync Drama drafts and library metadata across devices | Current browser-local persistence makes switching from phone to computer harder | An authenticated user can resume the same draft on a second device without losing edits |
| 4 | Replace the Analyze example forecast with measured metrics and date ranges | The current forecast is explicitly labeled as an example; measured results would support decisions | Metrics identify their source, time range, loading state and missing-data state |
| 5 | Add Continue latest draft to Home | Shortens the route from the welcome page to unfinished work | Home links to the latest available draft and shows a helpful empty state |
| 6 | Allow a small set of favorite tools on Home | Frequent users can reach their preferred tools while retaining the common navigation | Favorites persist per user and work with keyboard and touch |
| 7 | Add search and status/type filters to My Contents | Helps a growing queue remain easy to browse | Users can find a saved creation by title and isolate completed or failed outputs without leaving the page |
| 8 | Run responsive UI checks in CI | Protects shared menus, spacing and workflow recovery from future regressions | Pull requests exercise representative populated screens, open menus and critical flows at desktop and phone widths |

Keep these changes incremental. Prefer inline progress, recovery and editing over additional modal dialogs or separate windows. Preserve ownership boundaries and existing generation/publishing safeguards.

Related: [Website capabilities](WEBSITE_CAPABILITIES.md), [research and design decisions](UX_RESEARCH_AND_DECISIONS.md), and [acceptance evidence](UX_ACCEPTANCE.md).
