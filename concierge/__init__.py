"""The concierge team's code: another team, in its own namespace, `concierge`.

    service.py        the Nexus contract: what other teams may call (the one module they import)
    handler.py        how each operation is served: by starting a workflow in this namespace
    agent.py          ConciergeAgent: an agent, with a model and tools of its own
    reservations.py   TableReservation: a plain workflow, no model
    worker.py         the concierge's worker (`travel-stack up` runs it)

Nothing in the travel agent reaches in here except through the `concierge` Nexus endpoint.
"""
