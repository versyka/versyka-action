# Test fixture for CI (v1.1.0): a Bedrock model ID gets Bedrock's own retirement date.
# Amazon Bedrock retired the Cohere Command R model below on 2026-08-19, so the action must report it as retired.
import boto3

bedrock = boto3.client("bedrock-runtime")
reply = bedrock.converse(modelId="cohere.command-r-v1:0", messages=[{"role": "user", "content": [{"text": "Hello"}]}])
