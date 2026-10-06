# Scala 3 sandbox image. Base: virtuslab/scala-cli (official Scala CLI image, ~4.9GB, bundles JDK + Scala 3).
# The sandbox runs with --network none, so the Scala compiler/library artifacts are resolved at BUILD time into
# /opt/socra/cache (world-readable) and used offline at run time.
FROM virtuslab/scala-cli:latest
ENV COURSIER_CACHE=/opt/socra/cache/coursier \
    SCALA_CLI_HOME=/opt/socra/cache/scalacli \
    XDG_CACHE_HOME=/opt/socra/cache/xdg
RUN mkdir -p /opt/socra/warm && cd /opt/socra/warm \
 && printf '@main def hi = println("warm")\n' > main.scala \
 && scala-cli run --server=false main.scala \
 && printf 'object T { def f(x: Int): Int = x }\n@main def hi = println(T.f(1))\n' > main.scala \
 && scala-cli run --server=false main.scala \
 && chmod -R a+rX /opt/socra \
 && du -sh /opt/socra/cache
COPY scala-harness.sh /opt/socra/run.sh
RUN chmod 755 /opt/socra/run.sh
ENTRYPOINT ["/opt/socra/run.sh"]
