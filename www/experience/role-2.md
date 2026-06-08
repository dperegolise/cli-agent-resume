# Senior Engineer, Developer Platform — Carto Systems

**2020–2023** | New York, NY (hybrid)

Carto Systems builds geospatial data infrastructure — cloud-native pipelines for ingesting,
transforming, and serving large-scale location datasets to enterprise GIS and analytics customers.
I joined as the fourth engineer on the developer platform team and left as one of the leads.

---

## Responsibilities

**Internal developer platform (IDP)**: Led the build-out of Carto's internal platform:
self-service service provisioning, standardized CI/CD pipelines (GitHub Actions + custom
orchestration), secrets management, and a Backstage-based developer portal. Reduced time-to-first
deploy for new services from ~2 weeks to ~4 hours.

**Data pipeline infrastructure**: Designed and owned the Rust-based tile-generation pipeline
that converts raw geospatial datasets (up to 200GB shapefiles) into Mapbox Vector Tiles for
CDN delivery. Replaced a brittle Python predecessor that required manual restarts 3-4 times
per week.

**Observability**: Built Carto's observability layer from scratch — structured logging
conventions, distributed tracing with OpenTelemetry, and a Grafana dashboard library shared
across 40+ services. Reduced mean time to root cause for production incidents from 45 minutes
to ~8 minutes.

**On-call & reliability**: Owned the on-call rotation for platform services; ran blameless
post-mortems; drove the SLO framework adoption that gave product teams concrete reliability
targets for the first time.

---

## Impact

- Tile generation pipeline: 12× throughput improvement over predecessor; zero manual
  restarts in 18 months after launch
- Developer portal: 94% adoption among engineering team within 6 months; reduced
  "how do I deploy this" questions in Slack by ~70% (measured via support ticket tracking)
- Led technical hiring for 4 senior platform engineer roles; conducted 60+ technical interviews

---

## Stack

Rust, Python, TypeScript, PostgreSQL, PostGIS, Redis, Kafka, Kubernetes, Terraform,
OpenTelemetry, Grafana, GitHub Actions
