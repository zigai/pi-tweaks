_:
    @just help

# List available commands
help:
    @just --list

# Format code
fmt:
    npm run format

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
