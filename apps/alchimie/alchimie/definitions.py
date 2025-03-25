from dagster import Definitions, load_assets_from_modules

from alchimie import assets  # noqa: TID252
from alchimie.jobs import my_k8s_job
all_assets = load_assets_from_modules([assets])

defs = Definitions(
    assets=all_assets,
    jobs=[my_k8s_job],
)
