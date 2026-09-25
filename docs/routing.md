# Routing v1

Filter enabled accounts, capability/model class, health, freshness, bucket exhaustion, reserves, and buckets whose reset has already passed. Among eligible accounts, maximize the smallest applicable remaining fraction above its reserve. If capacities are within five percentage points, prefer the account with a sooner reset within two hours; priority breaks further ties. Return every candidate's eligibility and inputs. Unknown measured capacity is not eligible; an account without a bucket for a requested model scope may not claim capacity for it.
