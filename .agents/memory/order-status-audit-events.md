---
name: Order-status audit events
description: How to use status logs safely when restoring a prior order state.
---

Status-log entries do not always represent a status change: operational actions
such as a forced in-motion trip reassignment can write a same-status audit row.
Any restore flow that derives a prior status from the log must select the latest
actual transition, not merely the latest entry for a status.

**Why:** A same-status reassignment record can otherwise mask the true
pre-postpone state and make an order impossible to resume. Concurrent rider
reassignment or deletion can also leave a status and its rider assignment out
of sync if they are checked independently.

**How to apply:** For state-restoration work, exclude same-status audit entries
when locating the origin. Put every state/assignment invariant and
role-sensitive ownership check in the final conditional write, so a concurrent
change fails safely rather than producing an inconsistent order.