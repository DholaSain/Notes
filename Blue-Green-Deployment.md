
## Overview

Create two envs from the same EB application:

- dira-prod-blue

- dira-prod-green


### CI/CD flow:

- Build & zip → upload to S3 → create EB application version
- Update IDLE EB env to that version
- Wait until EB says Updated and Health = Green, do smoke test
- Flip the ALB listener rule to point to the IDLE env’s TG (now green)
- (Optional) Update SSM /myapp/prod/active_env to remember who’s active
- Keep the previous env as hot rollback or scale it down later

> Important: EB creates and tags its TGs with
> elasticbeanstalk:environment-name=<env-name>. We’ll dynamically
> discover the TG ARN for each env via tags, then update your shared ALB
> listener rule to forward to the new TG.

### GitHub Actions: end-to-end YAML (shared ALB, host-header → TG)

- Assumes you’ve set repository Variables (Settings → Variables), not Secrets, for easy reference.

Required repo Variables (example values in comments):
```ini
AWS_REGION=us-east-1
EB_APP_NAME=MyApp
EB_ENV_BLUE=myapp-prod-blue
EB_ENV_GREEN=myapp-prod-green
EB_BUCKET=myapp-eb-artifacts
EB_KEY_PREFIX=prod/                  # optional subfolder in S3
PROD_AWS_ACTIONS_ROLE=arn:aws:iam::123:role/gh-actions-deployer
HEALTHCHECK_PATH=/healthz
# The specific shared ALB listener rule that matches Host: api.example.com
SHARED_ALB_LISTENER_RULE_ARN=arn:aws:elasticloadbalancing:...:listener-rule/app/your-alb/.../rule/abc123
# Optional: track active color; start with 'blue' or 'green'
SSM_ACTIVE_ENV_PARAM=/myapp/prod/active_env
```
```yaml
name: Blue-Green

on:
  push:
    branches: ['main']
  workflow_dispatch:

concurrency:
  group: production-deploy
  cancel-in-progress: false

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: read

    env:
      AWS_REGION: ${{ vars.AWS_REGION }}
      EB_APP_NAME: ${{ vars.EB_APP_NAME }}
      EB_ENV_BLUE: ${{ vars.EB_ENV_BLUE }}
      EB_ENV_GREEN: ${{ vars.EB_ENV_GREEN }}
      EB_BUCKET: ${{ vars.EB_BUCKET }}
      EB_KEY_PREFIX: ${{ vars.EB_KEY_PREFIX }}
      HEALTHCHECK_PATH: ${{ vars.HEALTHCHECK_PATH }}
      SHARED_ALB_LISTENER_RULE_ARN: ${{ vars.SHARED_ALB_LISTENER_RULE_ARN }}
      SSM_ACTIVE_ENV_PARAM: ${{ vars.SSM_ACTIVE_ENV_PARAM }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Prereqs
        uses: ./.github/action/

      - name: Node install & build
        run: |
          npm ci
          npm run build

      - name: Create EB application bundle
        run: |
          mkdir -p dist/.ebextensions dist/pdf-templates
          cp Procfile dist/Procfile
          cp package.json dist/package.json
          cp package-lock.json dist/package-lock.json
          cp prisma/schema.prisma dist/prisma/schema.prisma
          cp .ebextensions/prod.crowdstrike.config dist/.ebextensions/crowdstrike.config
          cp -r .platform dist
          cp pdf-templates/contributions-receipt.hbs dist/pdf-templates/contributions-receipt.hbs
          (cd dist && zip -r ../dist.zip .)

      - name: Configure AWS credentials
        uses: aws-actions/configure-aws-credentials@v4
        with:
          aws-region: ${{ env.AWS_REGION }}
          role-to-assume: ${{ vars.PROD_AWS_ACTIONS_ROLE }}

      - name: Compute version label & S3 key
        id: ver
        run: |
          VERSION="prod-${GITHUB_SHA::7}-$(date +%Y%m%d%H%M%S)"
          S3KEY="${EB_KEY_PREFIX}${VERSION}.zip"
          echo "version=$VERSION" >> $GITHUB_OUTPUT
          echo "s3key=$S3KEY" >> $GITHUB_OUTPUT

      - name: Upload bundle to S3
        run: aws s3 cp dist.zip "s3://${EB_BUCKET}/${{ steps.ver.outputs.s3key }}"

      - name: Create EB application version
        run: |
          aws elasticbeanstalk create-application-version \
            --application-name "$EB_APP_NAME" \
            --version-label "${{ steps.ver.outputs.version }}" \
            --source-bundle S3Bucket="$EB_BUCKET",S3Key="${{ steps.ver.outputs.s3key }}"

      - name: Determine ACTIVE and IDLE env (via SSM, default=blue)
        id: whichenv
        run: |
          ACTIVE=$(aws ssm get-parameter --name "$SSM_ACTIVE_ENV_PARAM" --query "Parameter.Value" --output text 2>/dev/null || echo "blue")
          if [ "$ACTIVE" = "blue" ]; then
            ACTIVE_ENV="$EB_ENV_BLUE"; IDLE_ENV="$EB_ENV_GREEN"; NEXT_ACTIVE="green"
          else
            ACTIVE_ENV="$EB_ENV_GREEN"; IDLE_ENV="$EB_ENV_BLUE"; NEXT_ACTIVE="blue"
          fi
          echo "active_env=$ACTIVE_ENV" >> $GITHUB_OUTPUT
          echo "idle_env=$IDLE_ENV"     >> $GITHUB_OUTPUT
          echo "next_active=$NEXT_ACTIVE" >> $GITHUB_OUTPUT
          echo "Active: $ACTIVE_ENV  Idle: $IDLE_ENV"

      - name: Update IDLE EB env to new version
        run: |
          aws elasticbeanstalk update-environment \
            --environment-name "${{ steps.whichenv.outputs.idle_env }}" \
            --version-label "${{ steps.ver.outputs.version }}"

      - name: Wait for EB update to complete
        run: |
          aws elasticbeanstalk wait environment-updated \
            --environment-names "${{ steps.whichenv.outputs.idle_env }}"
          # poll health: up to ~5 minutes
          for i in {1..30}; do
            H=$(aws elasticbeanstalk describe-environments --environment-names "${{ steps.whichenv.outputs.idle_env }}" --query "Environments[0].Health" --output text)
            echo "Health: $H"
            [ "$H" = "Green" ] && break
            sleep 10
          done
          [ "$H" = "Green" ] || (echo "Environment not healthy" && exit 1)

      - name: Smoke test IDLE env (direct EB CNAME)
        run: |
          CNAME=$(aws elasticbeanstalk describe-environments \
            --environment-names "${{ steps.whichenv.outputs.idle_env }}" \
            --query "Environments[0].CNAME" --output text)
          echo "Testing https://${CNAME}${HEALTHCHECK_PATH}"
          curl -fsSL "https://${CNAME}${HEALTHCHECK_PATH}" -m 10

      - name: Discover Target Group ARN for IDLE env
        id: tg
        run: |
          IDLE="${{ steps.whichenv.outputs.idle_env }}"
          # 1) list all TGs in the region
          TG_ARNS=$(aws elbv2 describe-target-groups --query "TargetGroups[].TargetGroupArn" --output text)
          FOUND=""
          for ARN in $TG_ARNS; do
            # 2) read tags for each; look for EB env tag
            NAME=$(aws elbv2 describe-tags --resource-arns "$ARN" \
              --query "TagDescriptions[0].Tags[?Key=='elasticbeanstalk:environment-name'].Value | [0]" --output text 2>/dev/null || echo "-")
            if [ "$NAME" = "$IDLE" ]; then
              FOUND="$ARN"
              break
            fi
          done
          if [ -z "$FOUND" ]; then
            echo "Failed to find Target Group for env $IDLE"; exit 1
          fi
          echo "idle_tg_arn=$FOUND" >> $GITHUB_OUTPUT
          echo "IDLE TG: $FOUND"

      # OPTIONAL: Weighted canary (10% -> 100%). Comment out if you prefer instant cutover.
      - name: Canary shift 10% to IDLE TG
        run: |
          BLUE_OR_GREEN_ACTIVE="${{ steps.whichenv.outputs.active_env }}"
          # Discover ACTIVE TG too (same method):
          ACTIVE_TG=""
          TG_ARNS=$(aws elbv2 describe-target-groups --query "TargetGroups[].TargetGroupArn" --output text)
          for ARN in $TG_ARNS; do
            NAME=$(aws elbv2 describe-tags --resource-arns "$ARN" \
              --query "TagDescriptions[0].Tags[?Key=='elasticbeanstalk:environment-name'].Value | [0]" --output text 2>/dev/null || echo "-")
            if [ "$NAME" = "$BLUE_OR_GREEN_ACTIVE" ]; then ACTIVE_TG="$ARN"; fi
          done
          [ -n "$ACTIVE_TG" ] || (echo "Active TG not found"; exit 1)
          aws elbv2 modify-rule \
            --rule-arn "$SHARED_ALB_LISTENER_RULE_ARN" \
            --actions "Type=forward,ForwardConfig={TargetGroups=[{TargetGroupArn=\"${{ steps.tg.outputs.idle_tg_arn }}\",Weight=10},{TargetGroupArn=\"$ACTIVE_TG\",Weight=90}]}"
          echo "Sleeping 60s before 100% cutover"; sleep 60

      - name: Cutover 100% to IDLE TG
        run: |
          aws elbv2 modify-rule \
            --rule-arn "$SHARED_ALB_LISTENER_RULE_ARN" \
            --actions "Type=forward,TargetGroupArn=${{ steps.tg.outputs.idle_tg_arn }}"
          echo "Listener rule now forwards 100% to IDLE TG."

      - name: Update SSM active color
        run: |
          NEXT="${{ steps.whichenv.outputs.next_active }}"
          aws ssm put-parameter --name "$SSM_ACTIVE_ENV_PARAM" --type String --overwrite --value "$NEXT"
          echo "Active color is now: $NEXT"
```

## IAM permissions you’ll need on the GitHub OIDC role

Minimum (coarse-grained shown; you can scope to specific resources later):

-   **Elastic Beanstalk**
    
    -   `elasticbeanstalk:CreateApplicationVersion`
        
    -   `elasticbeanstalk:UpdateEnvironment`
        
    -   `elasticbeanstalk:DescribeEnvironments`
        
    -   `elasticbeanstalk:DescribeEnvironmentResources`
        
    -   `elasticbeanstalk:Wait*` (implicit via AWS CLI waiter)
        
-   **S3**
    
    -   `s3:PutObject` (to your artifact bucket/key)
        
-   **ELBv2 (ALB)**
    
    -   `elasticloadbalancing:DescribeTargetGroups`
        
    -   `elasticloadbalancing:DescribeTags`
        
    -   `elasticloadbalancing:ModifyRule`
        
    -   (If you later automate rule creation/conditions: `CreateRule`, `DeleteRule`, `SetRulePriorities`)
        
-   **SSM Parameter Store**
    
    -   `ssm:GetParameter`, `ssm:PutParameter`
----------

## Health, draining, and smoke tests

-   EB environments should return **200** at `GET /healthz`. Configure:
    
    -   EB “Process” HealthCheckPath `/healthz`
        
    -   TG health check path `/healthz`
        
    -   ALB **deregistration delay** (connection draining) ≥ 30–60s
        
-   The workflow waits for **EB Health = Green** and runs a **curl** against the idle env CNAME before flipping the shared ALB rule.
    
-   You can extend smoke tests (e.g., a read-only DB query endpoint).
