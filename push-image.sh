#!/bin/bash

# Shared values come from match-config (deploy section); run from the repo root.
RELEASE_TAG=$(node -p "require('match-config').getConfig('deploy').release_tag") || exit 1
if [[ "$RELEASE_TAG" == "null" ]]; then
    echo "Error: deploy.release_tag is not set."
    exit 1
fi
BACKEND_REPO=$(node -p "require('match-config').getConfig('deploy').backend_repo") || exit 1

ENV_FILE=
OTHER=


# Parse command-line arguments
while [[ "$#" -gt 0 ]]; do
    case "$1" in
        -e|--envfile) 
            ENV_FILE="$2"
            shift 2 ;;  # Move past option and value
        -o|--other) 
            OTHER="$2"
            shift 2 ;;
        *)
            echo "Unknown option: $1"
            exit 1 ;;
    esac
done

# Ensure name is provided (required argument)
if [[ -z "$ENV_FILE" ]]; then
    echo "Error: Env file is required."
    exit 1
fi
if ! [ -f $ENV_FILE ]; then
    echo "Error: Env file does not exist."
    exit 1
fi

printf "Env file: ${ENV_FILE}:\n\n"
cat $ENV_FILE
printf "\n\n"

while true; do
    echo -e "Are you sure you wanna follow? [y/n]"
    read amisure
    if [ $amisure == "y" ]; then
        break
    elif [ $amisure == "n" ]; then
        exit 1
    fi
done

# A git clone, not the GitHub zip archive: archives leave out submodules, and
# the backend image copies vendor/match-config into the build.
mkdir temp/
git clone --depth 1 --branch ${RELEASE_TAG} --recurse-submodules \
    https://github.com/${BACKEND_REPO} temp/match-backend-${RELEASE_TAG}
dockerFileDir="temp/match-backend-${RELEASE_TAG}/Dockerfile"



npx ts-node lib/script.ts push-docker-image $ENV_FILE $dockerFileDir
