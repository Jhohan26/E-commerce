-- MySQL dump 10.13  Distrib 26.7.0, for Win64 (x86_64)
--
-- Host: localhost    Database: inventario
-- ------------------------------------------------------
-- Server version	26.7.0

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
SET @MYSQLDUMP_TEMP_LOG_BIN = @@SESSION.SQL_LOG_BIN;
SET @@SESSION.SQL_LOG_BIN= 0;

--
-- GTID state at the beginning of the backup 
--

SET @@GLOBAL.GTID_PURGED=/*!80000 '+'*/ '46f6143a-b7a4-11f1-8393-7c8ae1b0d3a3:1-73';

--
-- Current Database: `inventario`
--

CREATE DATABASE /*!32312 IF NOT EXISTS*/ `inventario` /*!40100 DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci */ /*!80016 DEFAULT ENCRYPTION='N' */;

USE `inventario`;

--
-- Table structure for table `inventario`
--

DROP TABLE IF EXISTS `inventario`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventario` (
  `producto_id` int NOT NULL,
  `nombre` varchar(150) DEFAULT NULL,
  `cantidad` int NOT NULL DEFAULT '0',
  `actualizado` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`producto_id`),
  CONSTRAINT `chk_inventario_cantidad` CHECK ((`cantidad` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `inventario`
--

LOCK TABLES `inventario` WRITE;
/*!40000 ALTER TABLE `inventario` DISABLE KEYS */;
INSERT INTO `inventario` VALUES (1,'MACBOOK',47,'2026-10-21 01:32:29'),(2,'Audífonos Bluetooth',42,'2026-10-21 01:19:46'),(3,'Camiseta básica',100,'2026-10-14 01:29:07'),(5,'jean azul',44,'2026-10-14 01:42:08'),(6,'Jabon',200,'2026-10-14 01:29:27'),(7,'Zapatera',50,'2026-10-14 01:29:32'),(8,'Mouse Bluetooth',149,'2026-10-14 01:46:50'),(15,'Portátil 14\"',2,'2026-10-14 01:32:58'),(16,'Mouse inalámbrico',2,'2026-10-14 01:32:59'),(17,'Teclado mecánico',8,'2026-10-06 04:17:59'),(18,'Monitor 24\"',3,'2026-10-06 04:17:59'),(19,'Audífonos Bluetooth',0,'2026-10-14 01:32:49');
/*!40000 ALTER TABLE `inventario` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `movimientoinventario`
--

DROP TABLE IF EXISTS `movimientoinventario`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `movimientoinventario` (
  `id` int NOT NULL AUTO_INCREMENT,
  `producto_id` int NOT NULL,
  `tipo` varchar(10) NOT NULL,
  `cantidad_anterior` int NOT NULL,
  `cantidad_nueva` int NOT NULL,
  `motivo` varchar(200) NOT NULL,
  `fecha` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mov_producto` (`producto_id`)
) ENGINE=InnoDB AUTO_INCREMENT=103 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `movimientoinventario`
--

LOCK TABLES `movimientoinventario` WRITE;
/*!40000 ALTER TABLE `movimientoinventario` DISABLE KEYS */;
INSERT INTO `movimientoinventario` VALUES (1,15,'AJUSTE',4,12,'Prueba','2026-10-07 04:27:21'),(2,19,'AJUSTE',0,25,'Pruebas','2026-10-08 00:46:15'),(52,1,'AJUSTE',0,50,'Recuento','2026-10-14 01:28:57'),(53,3,'AJUSTE',0,100,'Recuento','2026-10-14 01:29:07'),(54,5,'AJUSTE',0,45,'Recuento','2026-10-14 01:29:19'),(55,6,'AJUSTE',0,200,'Recuento','2026-10-14 01:29:27'),(56,7,'AJUSTE',0,50,'Recuento','2026-10-14 01:29:32'),(57,8,'AJUSTE',0,150,'Recuento','2026-10-14 01:29:37'),(58,19,'AJUSTE',25,0,'Recuento','2026-10-14 01:32:49'),(59,15,'AJUSTE',12,2,'Recuento','2026-10-14 01:32:58'),(60,16,'AJUSTE',50,2,'Recuento','2026-10-14 01:32:59');
/*!40000 ALTER TABLE `movimientoinventario` ENABLE KEYS */;
UNLOCK TABLES;

--
-- Table structure for table `pedidoprocesado`
--

DROP TABLE IF EXISTS `pedidoprocesado`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `pedidoprocesado` (
  `pedido_id` bigint NOT NULL,
  `resultado` varchar(20) NOT NULL,
  `evento_json` text NOT NULL,
  `procesado_en` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`pedido_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Dumping data for table `pedidoprocesado`
--

LOCK TABLES `pedidoprocesado` WRITE;
/*!40000 ALTER TABLE `pedidoprocesado` DISABLE KEYS */;
INSERT INTO `pedidoprocesado` VALUES (1001,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1001, \"clienteId\": 25, \"fecha\": \"2026-10-05T23:35:27\", \"productos\": [{\"productoId\": 15, \"cantidad\": 2}]}','2026-10-06 04:35:27'),(1002,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1002, \"clienteId\": 25, \"fecha\": \"2026-10-05T23:36:29\", \"faltantes\": [{\"productoId\": 15, \"solicitado\": 20, \"disponible\": 8}]}','2026-10-06 04:36:29'),(1003,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1003, \"clienteId\": 25, \"fecha\": \"2026-10-05T23:58:17\", \"productos\": [{\"productoId\": 15, \"cantidad\": 2}]}','2026-10-06 04:58:17'),(1004,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1004, \"clienteId\": 10, \"fecha\": \"2026-10-06T00:08:11\", \"productos\": [{\"productoId\": 15, \"cantidad\": 1}]}','2026-10-06 05:08:11'),(1005,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1005, \"clienteId\": 25, \"fecha\": \"2026-10-06T00:13:42\", \"productos\": [{\"productoId\": 2, \"cantidad\": 1}]}','2026-10-06 05:13:42'),(1006,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1006, \"clienteId\": 25, \"fecha\": \"2026-10-06T00:14:25\", \"faltantes\": [{\"productoId\": 2, \"solicitado\": 500, \"disponible\": 49}]}','2026-10-06 05:14:25'),(1007,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1007, \"clienteId\": 10, \"fecha\": \"2026-10-07T18:50:50\", \"faltantes\": [{\"productoId\": 8, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-07 23:50:50'),(1008,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1008, \"clienteId\": 25, \"fecha\": \"2026-10-07T18:50:49\", \"faltantes\": [{\"productoId\": 5, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-07 23:50:49'),(1009,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1009, \"clienteId\": 1, \"fecha\": \"2026-10-07T18:50:49\", \"faltantes\": [{\"productoId\": 5, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-07 23:50:49'),(1010,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1010, \"clienteId\": 1, \"fecha\": \"2026-10-07T20:10:03\", \"faltantes\": [{\"productoId\": 5, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 01:10:03'),(1011,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1011, \"clienteId\": 1, \"fecha\": \"2026-10-07T20:20:40\", \"faltantes\": [{\"productoId\": 1, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 01:20:40'),(1012,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1012, \"clienteId\": 25, \"fecha\": \"2026-10-13T19:36:01\", \"faltantes\": [{\"productoId\": 7, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-14 00:36:01'),(1013,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1013, \"clienteId\": 25, \"fecha\": \"2026-10-13T19:36:01\", \"faltantes\": [{\"productoId\": 8, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-14 00:36:01'),(1014,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1014, \"clienteId\": 25, \"fecha\": \"2026-10-13T19:36:02\", \"faltantes\": [{\"productoId\": 5, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-14 00:36:02'),(1015,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1015, \"clienteId\": 25, \"fecha\": \"2026-10-13T19:36:02\", \"faltantes\": [{\"productoId\": 3, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-14 00:36:02'),(1016,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1016, \"clienteId\": 25, \"fecha\": \"2026-10-13T19:36:02\", \"productos\": [{\"productoId\": 2, \"cantidad\": 2}]}','2026-10-14 00:36:02'),(1017,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1017, \"clienteId\": 25, \"fecha\": \"2026-10-13T19:36:03\", \"faltantes\": [{\"productoId\": 1, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-14 00:36:03'),(1018,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1018, \"clienteId\": 1, \"fecha\": \"2026-10-13T19:36:03\", \"productos\": [{\"productoId\": 2, \"cantidad\": 1}]}','2026-10-14 00:36:03'),(1019,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1019, \"clienteId\": 5, \"fecha\": \"2026-10-13T19:36:04\", \"faltantes\": [{\"productoId\": 8, \"solicitado\": 3, \"disponible\": 0}]}','2026-10-14 00:36:04'),(1020,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1020, \"clienteId\": 25, \"fecha\": \"2026-10-07T18:50:52\", \"faltantes\": [{\"productoId\": 20, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-07 23:50:52'),(1021,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1021, \"clienteId\": 6, \"fecha\": \"2026-10-13T20:42:08\", \"productos\": [{\"productoId\": 5, \"cantidad\": 1}]}','2026-10-14 01:42:08'),(1022,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1022, \"clienteId\": 6, \"fecha\": \"2026-10-13T20:46:50\", \"productos\": [{\"productoId\": 1, \"cantidad\": 1}, {\"productoId\": 2, \"cantidad\": 1}, {\"productoId\": 8, \"cantidad\": 1}]}','2026-10-14 01:46:50'),(1023,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1023, \"clienteId\": 1, \"fecha\": \"2026-10-20T20:19:45\", \"productos\": [{\"productoId\": 1, \"cantidad\": 1}]}','2026-10-21 01:19:45'),(1024,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1024, \"clienteId\": 2, \"fecha\": \"2026-10-20T20:19:46\", \"productos\": [{\"productoId\": 2, \"cantidad\": 1}]}','2026-10-21 01:19:46'),(1025,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1025, \"clienteId\": 1, \"fecha\": \"2026-10-20T20:32:29\", \"productos\": [{\"productoId\": 1, \"cantidad\": 1}]}','2026-10-21 01:32:29'),(2005,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 2005, \"clienteId\": 25, \"fecha\": \"2026-10-06T22:25:31\", \"productos\": [{\"productoId\": 15, \"cantidad\": 1}]}','2026-10-07 03:25:31'),(910041,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 910041, \"clienteId\": 25, \"fecha\": \"2026-10-07T19:42:52\", \"faltantes\": [{\"productoId\": 20, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 00:42:52'),(1791406813341,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791406813341, \"clienteId\": 1, \"fecha\": \"2026-10-07T18:50:50\", \"faltantes\": [{\"productoId\": 1, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-07 23:50:50'),(1791414637106,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791414637106, \"clienteId\": 1, \"fecha\": \"2026-10-07T18:50:51\", \"faltantes\": [{\"productoId\": 3, \"solicitado\": 3, \"disponible\": 0}]}','2026-10-07 23:50:51'),(1791419155235,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791419155235, \"clienteId\": 1, \"fecha\": \"2026-10-07T19:25:51\", \"faltantes\": [{\"productoId\": 3, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 00:25:51'),(1791419329504,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791419329504, \"clienteId\": 1, \"fecha\": \"2026-10-07T19:28:45\", \"faltantes\": [{\"productoId\": 3, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 00:28:45'),(1791419392516,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1791419392516, \"clienteId\": 2, \"fecha\": \"2026-10-07T19:29:48\", \"productos\": [{\"productoId\": 2, \"cantidad\": 1}]}','2026-10-08 00:29:48'),(1791420304379,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791420304379, \"clienteId\": 1, \"fecha\": \"2026-10-07T19:45:00\", \"faltantes\": [{\"productoId\": 3, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 00:45:00'),(1791420450598,'ACTUALIZADO','{\"evento\": \"InventarioActualizado\", \"pedidoId\": 1791420450598, \"clienteId\": 1, \"fecha\": \"2026-10-07T19:47:26\", \"productos\": [{\"productoId\": 2, \"cantidad\": 1}]}','2026-10-08 00:47:26'),(1791420917229,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791420917229, \"clienteId\": 1, \"fecha\": \"2026-10-07T19:55:13\", \"faltantes\": [{\"productoId\": 6, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 00:55:13'),(1791421160373,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791421160373, \"clienteId\": 1, \"fecha\": \"2026-10-07T19:59:16\", \"faltantes\": [{\"productoId\": 1, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 00:59:16'),(1791421317547,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791421317547, \"clienteId\": 1, \"fecha\": \"2026-10-07T20:01:53\", \"faltantes\": [{\"productoId\": 6, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 01:01:53'),(1791421561774,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791421561774, \"clienteId\": 3, \"fecha\": \"2026-10-07T20:05:58\", \"faltantes\": [{\"productoId\": 6, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 01:05:58'),(1791421652321,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791421652321, \"clienteId\": 3, \"fecha\": \"2026-10-07T20:07:29\", \"faltantes\": [{\"productoId\": 1, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 01:07:29'),(1791423434984,'INSUFICIENTE','{\"evento\": \"InventarioInsuficiente\", \"pedidoId\": 1791423434984, \"clienteId\": 2, \"fecha\": \"2026-10-07T20:37:56\", \"faltantes\": [{\"productoId\": 1, \"solicitado\": 1, \"disponible\": 0}]}','2026-10-08 01:37:56');
/*!40000 ALTER TABLE `pedidoprocesado` ENABLE KEYS */;
UNLOCK TABLES;
SET @@SESSION.SQL_LOG_BIN = @MYSQLDUMP_TEMP_LOG_BIN;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

-- Dump completed on 2026-10-21  6:58:37
