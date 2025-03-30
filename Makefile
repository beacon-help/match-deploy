build-stack:
	npm run build

deploy-stack:
	npx cdk deploy --asset-prebuild --outputs-file outputs.json --rollback
