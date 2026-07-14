_:
    @just help

# List available commands
help:
    @just --list

# Format code
fmt:
    npm run format

# Generate config schemas and README sections
config-generate:
    npm run config:generate

# Check generated config artifacts
config-check:
    npm run config:check

# Check code for lint issues
lint:
    npm run lint

# Run tests
test:
    npm test

# Run all non-mutating checks
check:
    npm run check

# Release a new version
release:
    npm run release

# Run a dry-run release
release-dry-run:
    npm run release:dry-run

# Apply automatic fixes
fix:
    npm run lint:fix
    npm run format
