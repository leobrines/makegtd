# Official GTD® reference documents

These PDFs are the **canonical source of truth** for every GTD-related decision in this
app. Before changing anything that touches the GTD workflow (statuses, views, wizards,
lists, review steps, calendar behavior), consult these documents and keep the app
faithful to them.

All documents are published for free by the David Allen Company on
[gettingthingsdone.com](https://gettingthingsdone.com) and are © David Allen Company.
They are stored here for offline reference only. Downloaded on 2026-07-14.

## Documents

| File | What it is | Source URL |
|---|---|---|
| `gtd-workflow-map.pdf` | **GTD® Workflow Map — Clarifying and Organizing.** The official decision-tree diagram: stuff → what is it? → is it actionable? → trash / incubate (Someday/Maybe, tickler) / reference, or → what's the next action? → do it (<2 min) / delegate (Waiting For) / defer (calendar or Next Actions), with multi-step outcomes becoming Projects. | <https://gettingthingsdone.com/wp-content/uploads/2024/05/GTD_workflow_map.pdf> |
| `gtd-weekly-review-checklist.pdf` | **GTD Weekly Review® Checklist.** The official 11 steps in 3 phases — Get Clear (collect loose papers; get "in" to zero; empty your head), Get Current (review Next Actions lists; review previous calendar; review upcoming calendar; review Waiting For; review Projects ensuring at least one next action each; review checklists), Get Creative (review Someday/Maybe; be creative & courageous). | <https://gettingthingsdone.com/wp-content/uploads/2016/04/GTD-WeeklyReview.pdf> |
| `gtd-setup-guide-paper-sample.pdf` | **David Allen Company Setup Guide (official sample).** The canonical system sections and setup order: In, Calendar, Next Actions lists (by context: Calls, Computer, Office, Home, Errands, Anywhere, Waiting For), Agendas, Projects, Project Support, Someday/Maybe, Focus & Direction, Reference, Contacts. Includes the five steps of mastering workflow and the calendar rule. | <https://gettingthingsdone.com/wp-content/uploads/2019/08/GT_Paper_Organizers_SAMPLE.pdf> |

## Canonical rules the app must honor

Extracted from the documents above; cite the document when relying on one of these.

1. **The five steps** (Setup Guide, p. 2): Capture → Clarify → Organize → Reflect →
   Engage. Every feature belongs to exactly one step; don't blur them (e.g. capture
   must never force clarification decisions).
2. **The calendar rule** (Setup Guide, p. 8, "Important" sidebar): only actions that
   *must* happen on a specific day/time go on the calendar (`scheduled`). Everything
   else belongs on Next Actions lists — the calendar is sacred territory, not a wish
   list.
3. **At least one next action per project** (Weekly Review Checklist, "Review Project
   Lists"): every active project must always have at least one current next action.
   The app surfaces projects that violate this.
4. **Next actions are organized by context** (Setup Guide, p. 8): contexts like
   `@casa`, `@ordenador`, `@recados` group actions by what's needed to do them.
   Sorting by context is the default recommendation, not mandatory.
5. **Weekly review = 11 steps, 3 phases** (Weekly Review Checklist): the review wizard
   in `js/review.js` must follow the official phases and step order.
6. **Clarify one item at a time** (Workflow Map): the decision tree is applied to one
   "stuff" item at a time — what is it? is it actionable? if yes, what's the next
   action? if multi-step, what outcome (project)? if <2 minutes, do it now; delegate →
   Waiting For; defer → calendar or Next Actions. If not actionable: trash, incubate
   (Someday/Maybe), or reference.
