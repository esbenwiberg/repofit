# Command execution evidence

Reports now retain the attempts RepoFit already executes, including warm-ups, failures and timeouts. JSON exposes optional `executions`; human and HTML output distinguish these observations from unchanged probe scores. Diagnostics are bounded to 4 KiB per stream.

No extra commands run, no latency bands change, and default static scans still execute no repository commands. First observed does not imply a clean cold environment. Third-party fixtures and report consumers can continue omitting the optional metadata.
