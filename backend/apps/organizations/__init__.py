"""Organizations domain.

Authoritative application boundary for the University of Gondar
organizational structure, covering institutional units, their managed
classifications and the adjacency-list hierarchy.

OrganizationType is the managed institutional classification lookup (DEC-04).
OrganizationUnit stores central institutional records, with recursive
traversal, serialized cycle-safe hierarchy mutations and protected lifecycle
transitions. REST APIs remain
subsequent stories.
"""
