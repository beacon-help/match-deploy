#!/bin/bash

BRANCH_NAME="main"

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

mkdir temp/
curl -L https://github.com/julekb/match-backend/archive/${BRANCH_NAME}.zip > temp/repo.zip
unzip temp/repo.zip -d temp/
dockerFileDir="temp/match-backend-${BRANCH_NAME}/Dockerfile"



npx ts-node lib/script.ts push-docker-image $ENV_FILE $dockerFileDir
