"""Digital property domain, separate from institutional OrganizationUnit records.

Site stores the digital property and its institutional owner. SiteDomain
stores that property's hostnames. SiteTemplate stores an approved starting
configuration that is copied when a Site is provisioned. Module is the
platform capability registry. A SiteModule row enables one shipped module
for one Site. Institutional hierarchy remains in Organizations.
"""
