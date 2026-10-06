#!/bin/sh
# Scala sandbox entry: the host sends a shell script on stdin (files are base64-embedded; see docker-runner.ts).
# Copy it to tmpfs first so student processes cannot read the remainder of the script from stdin.
cat > /tmp/job.sh
export HOME=/work SCALA_CLI_HOME=/tmp/sc
exec sh /tmp/job.sh
