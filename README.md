How to run the script!

1. Make sure your gps and external wifi adapter are connected to the gps.
2. Run the script with admin level access.

The program will begin collecting data once a gps fix has been acquired. Sometimes certain Linux background processes will interrupt the collection process, you can disable these by using `sudo airmon-ng check kill` assuming it is installed on your system.

The script will create a new SQLite database instance and write data to it, every 30 seconds the script will make a JSON copy of the db that can be uploaded to the site's public folder. The site is designed to work with realtime updates, so you can run the script in the public folder to get updates every thirty seconds!
