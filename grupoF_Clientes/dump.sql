-- MySQL dump 10.13  Distrib 8.0.45, for Win64 (x86_64)
--
-- Host: localhost    Database: clientes
-- ------------------------------------------------------
-- Server version	8.0.45

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `cliente`
--

DROP TABLE IF EXISTS `cliente`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cliente` (
  `id` int NOT NULL AUTO_INCREMENT,
  `primer_nombre` varchar(45) NOT NULL,
  `segundo_nombre` varchar(45) DEFAULT NULL,
  `primer_apellido` varchar(45) NOT NULL,
  `segundo_apellido` varchar(45) DEFAULT NULL,
  `correo` varchar(127) NOT NULL,
  `contraseña` varchar(255) NOT NULL,
  `estado` tinyint DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `id_UNIQUE` (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=7 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `cliente`
--

LOCK TABLES `cliente` WRITE;
/*!40000 ALTER TABLE `cliente` DISABLE KEYS */;
INSERT INTO `cliente` VALUES (1,'Jhohan',NULL,'Reyes',NULL,'jhohanes2004@gmail.com','$2b$12$k3anQN/KDgdaSAUt80JyReIdOLbzQkIj6KgqpRHq7bterhfNrFK8a',1),(2,'Juan','Serna','Saenz',NULL,'juan@gmail.com','$2b$12$eT8m43qd3/3YbWFq3jYFDObZESlWucmYWpSypX3YcF6WIfQe7.rmy',1),(3,'Olmes','Usmany','Leonel','Garcia','tkd@gmail.com','$2b$12$ppVl3FeFNYmlOl5t7Pa3T.vLxQfPHOKBnl1p6tLuQAHOy3JEQb3w.',1),(4,'Brayan','Stiven','Lozano',NULL,'lozano1705@hotmail.com','$2b$12$fv0qM9UC8Jqaap8bD3uDx.oCSyo4749RZeSDJVNUqgnaN0rsb8Kei',1),(5,'David','Santiago','Medina','Castro','santi@gmail.com','$2b$12$pjIZSD.XF5oCMa8w2qIxHOtwRuH/4p3s8TGBRN4Dq/89HsbvT0uwi',1),(6,'sergio',NULL,'giraldo',NULL,'juanestebanserna1024@gmail.com','$2b$12$KBNMIUDjQVEHDEmHeJrJV.sz7Q8DYhqV0q5B/v8DyGramhHQwXZdO',1);
/*!40000 ALTER TABLE `cliente` ENABLE KEYS */;
UNLOCK TABLES;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-21  6:03:22
