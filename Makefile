build-stack:
	npm run build

# Dry run by default: read-only checks against AWS, nothing is deployed.
# `make deploy-stack DEPLOY=1` runs the same checks, then deploys.
deploy-stack:
	npx ts-node --prefer-ts-exts scripts/deploy.ts $(if $(filter 1,$(DEPLOY)),--deploy,)
