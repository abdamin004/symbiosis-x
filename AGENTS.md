# SYMBIOSIS X repository instructions

Read the ticket in Jira and its entry in the checked-in [build plan](SYMBIOSIS%20X%20Feature%20Backlog%20and%20Build%20Plan.html). Use the [technical architecture](SYMBIOSIS%20X%20Technical%20Architecture.html) for interfaces and ownership. The ticket defines the files to edit and the acceptance check. Keep shared changes coordinated with the named producer, consumer and reviewer.

- Build the local, deterministic simulation with Python and FastAPI, SQLite, and React in JavaScript/JSX. Keep simulation and assessment logic in Python. Use the shared examples for UI mocks.
- Label synthetic data, carry units and provenance, and preserve the difference between mission time, observation time and delivery time. Private Crew data stays in the Crew projection. Build Ground from an explicit allowlist of delivered data.
- Keep emergency workflows in the simulated training scope. Crew acts onboard independently of Ground delivery. Planner and workflow output is advisory and any simulated plant change goes through the authorized commit gate.
- Use the specialist roles in `.codex/agents/` when asked to delegate. Publish on the member's long-lived branch listed in the README. Give each writer separate ticket paths or an isolated worktree and coordinate shared contracts through the integration owner. Report conflicts before making overlapping edits.
- Before starting a ticket, assign it to the person directing the work and move it to In Progress. Merge tested work into main, then move the ticket to In Review for a teammate to check.
- Run the ticket's acceptance check and the contract suite for shared payload changes. Report exact commands, results, and unverified boundaries. Keep local SQLite files, credentials and real health records out of version control.
