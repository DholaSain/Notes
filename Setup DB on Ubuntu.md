##Install PostgreSQL

Connect to your GCE instance via SSH.
Update your package list: 
```bash
sudo apt-get update
```

Install PostgreSQL: 
```bash
sudo apt-get install postgresql postgresql-contrib
```

Configure PostgreSQL:

Switch to the postgres user: 
```bash
sudo -i -u postgres
```

Access the PostgreSQL prompt: 
```bash
psql
```

Create a database for your NestJS app: 
```SQL
CREATE DATABASE your_database_name;
```
Create a user and password for accessing the database (substitute your own details): 
```SQL
CREATE USER your_username WITH ENCRYPTED PASSWORD 'your_password';
```
or update the password of postgres:
```SQL
ALTER USER postgres WITH ENCRYPTED PASSWORD 'PASSWORD';
```

Grant privileges to the user: 
```bash
GRANT ALL PRIVILEGES ON DATABASE your_database_name TO your_username;
```

Exit the PostgreSQL prompt: 
```bash
\q
```
and then exit to return to your regular user.
Modify PostgreSQL Configurations to Allow Connections:

Open the PostgreSQL configuration file for editing:
```bash
sudo nano /etc/postgresql/{version}/main/postgresql.conf
```
Look for the line that says #listen_addresses = 'localhost' and change it to listen_addresses = '*'
Then, edit the pg_hba.conf file: 
```bash
sudo nano /etc/postgresql/{version}/main/pg_hba.conf
```
check PSQL version
```bash
psql -c "SELECT version();"
```
Add a line: 
```
host all all 0.0.0.0/0 md5
```
Restart PostgreSQL to apply changes: 
```bash
sudo systemctl restart PostgreSQL
```

Configure NestJS to Use the PostgreSQL Database:

In your NestJS application, configure the database connection settings to point to your new PostgreSQL database using the username, password, and database name you created.
Set Up a Reverse Proxy (Optional):

If you haven't already, set up a reverse proxy like Nginx or Apache on your GCE instance to direct requests to your Node.js app.
This includes setting up a server block or virtual host for your domain and proxying requests to the port where your NestJS app runs.
Open the Necessary Firewall Ports:

If your database should be accessible externally, make sure to open the necessary firewall ports. The default PostgreSQL port is 5432.
You can do this by navigating to the VPC Network section in your GCP console and configuring the firewall rules.
Secure your Database:

As a best practice, ensure secure passwords and access control are in place, and consider encrypting the data in transit and at rest.
For production environments, it's also recommended to limit access to the database server only to the necessary IPs or services and perform regular backups.
