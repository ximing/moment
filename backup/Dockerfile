FROM mysql:8.4
RUN microdnf install -y python3 python3-pip \
  && pip3 install --no-cache-dir awscli \
  && microdnf clean all
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh
CMD ["/usr/local/bin/backup.sh"]
