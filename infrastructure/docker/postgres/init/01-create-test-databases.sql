-- Runs once, when the postgres volume is first initialised (docker-entrypoint-initdb.d).
-- Creates the databases used by the integration and end-to-end test suites. Test suites refuse to
-- reset any database whose name does not end in "_test" / is not dedicated to tests.
SELECT 'CREATE DATABASE nexora_test' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'nexora_test')\gexec
SELECT 'CREATE DATABASE nexora_e2e' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'nexora_e2e')\gexec
