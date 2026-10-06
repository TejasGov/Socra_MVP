FROM python:3.12-alpine
COPY bootstrap.py harness.py /opt/socra/
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONHASHSEED=0
ENTRYPOINT ["python", "/opt/socra/bootstrap.py"]
