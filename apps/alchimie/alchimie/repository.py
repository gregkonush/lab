from dagster import repository

@repository
def alchimie_repository():
    """Define all jobs, assets, schedules, and sensors for this repository."""
    return [
        my_asset,
        my_k8s_job,
        my_schedule,
        my_sensor,
    ]
