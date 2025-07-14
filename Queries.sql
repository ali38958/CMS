

--Create a new user in SQL Server
USE CMS;  -- Make sure you're in the correct database
-- Grant specific permissions
GRANT INSERT, SELECT, UPDATE, DELETE ON dbo.Colony TO cms_user1;
-- Or grant all table permissions (more permissive)
GRANT ALL ON dbo.Colony TO cms_user1;
-- Or make the user db_owner (for development only - not recommended for production)
ALTER ROLE db_owner ADD MEMBER cms_user1;

BEGIN TRANSACTION;
-- Step 1: Create a new SQL Server login
CREATE LOGIN cms_user1 WITH PASSWORD = 'StrongPass456';
-- Step 2: Switch to the CMS database
USE CMS;
-- Step 3: Create a user inside the CMS database for that login
CREATE USER cms_user1 FOR LOGIN cms_user1;
-- Step 4: Give permissions (optional but common: read/write)
ALTER ROLE db_datareader ADD MEMBER cms_user1;
ALTER ROLE db_datawriter ADD MEMBER cms_user1;
ROLLBACK;

CREATE LOGIN cms_user1 WITH PASSWORD = 'StrongPassword456';
USE CMS;
CREATE USER cms_user1 FOR LOGIN cms_user1;







--Users
CREATE TABLE Users (
    UserID INT IDENTITY(1,1) PRIMARY KEY,
    Name VARCHAR(100),
    PhoneNumber VARCHAR(20) UNIQUE,
    Email VARCHAR(100)
);

--Colonies
CREATE TABLE Colonies (
    ColonyID INT  PRIMARY KEY,
    Name VARCHAR(100)
);

--Buildings
CREATE TABLE Buildings (
    BuildingID INT IDENTITY(1,1) PRIMARY KEY,
    ColonyID INT FOREIGN KEY REFERENCES Colonies(ColonyID),
    BuildingName VARCHAR(100)
);


--Nature
CREATE TABLE Nature (
    NatureID INT IDENTITY(1,1) PRIMARY KEY,
    Name VARCHAR(100)
);

--Categories
CREATE TABLE Categories (
    CategoryID INT IDENTITY(1,1) PRIMARY KEY,
    NatureID INT FOREIGN KEY REFERENCES Nature(NatureID),
    Name VARCHAR(100)
);

--CategoryTypes
CREATE TABLE CategoryTypes (
    TypeID INT IDENTITY(1,1) PRIMARY KEY,
    CategoryID INT FOREIGN KEY REFERENCES Categories(CategoryID),
    Description VARCHAR(255)
);

--Designations
CREATE TABLE Designations (
    DesignationID INT IDENTITY(1,1) PRIMARY KEY,
    Name VARCHAR(100)
);

--Skillmen
CREATE TABLE Skillmen (
    SkillmanID INT IDENTITY(1,1) PRIMARY KEY,
    Name VARCHAR(100),
    Email VARCHAR(100),
    PhoneNumber VARCHAR(20) UNIQUE,
    Type VARCHAR(50), -- Nature Wise, Building Wise, Open
    DesignationID INT FOREIGN KEY REFERENCES Designations(DesignationID)
);

--🧠 Helpful Notes
-- Foreign keys enforce relationship integrity.
-- IDENTITY(1,1) auto-increments each primary key.
-- Use VARCHAR sizes based on expected max input.
-- You can later create views or JOINs to extract linked data for reporting.











--TEMPORARY Data for testing
CREATE TABLE Colonies (
    Name VARCHAR(100),
    ColonyNumber VARCHAR(30) PRIMARY KEY,
    NumberOfBuildings INT
);
INSERT INTO Colonies(Name, ColonyNumber, NumberOfBuildings) VALUES
('Faisal', '11234501', 813),
('Afzal', '1123454', 512),
('Ashraf', '1123491', 659);

SELECT * FROM Colonies;
