import { compareString, hashString } from '../../utils/hashUtils.js';
import dotenv from 'dotenv';
import {
  sendContactEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
} from '../../utils/nodemailerUtils.js';
import userDal from './user.dal.js';
import jwt from 'jsonwebtoken';
import { parseISO, differenceInCalendarDays, addDays } from 'date-fns';

dotenv.config();

class UserControllers {
  sendEmail = async (req, res) => {
    const { name, email, message } = req.body;
    try {
      await sendContactEmail({ name, email, message });
      res.status(200).json({ message: 'Correo enviado correctamente' });
    } catch (error) {
      res.status(500).json({ error: 'Error al enviar el correo' });
    }
  };

  register = async (req, res) => {
    try {
      const { email, password } = req.body;
      const result = await userDal.findUserByEmail(email);
      if (result.length) {
        throw { message: 'Este correo ya está registrado' };
      }
      const hashedPassword = await hashString(password);
      const newUser = { email, password: hashedPassword };
      const insertResult = await userDal.register(newUser);
      const user_id = insertResult.insertId;

      const token = jwt.sign({ user_id }, process.env.TOKEN_KEY, {
        expiresIn: '1d',
      });
      await sendVerificationEmail({ user_id, email });
      res.status(201).json({
        message: 'Usuario creado. Revisa tu correo para confirmar tu cuenta.',
      });
    } catch (error) {
      res.status(500).json(error);
    }
  };

  verifyEmail = async (req, res) => {
    try {
      const { token } = req.params;

      const decoded = jwt.verify(token, process.env.VERIFY_TOKEN_KEY);
      const user_id = decoded.user_id;

      if (!user_id) {
        throw new Error('Token inválido: user_id no presente');
      }

      await userDal.confirmUser(user_id);

      res.redirect(`${process.env.FRONTEND_URL}/verified`);
    } catch (error) {
      console.error('Error en verifyEmail:', error.message);
      res.redirect(`${process.env.FRONTEND_URL}/verified?error=1`);
    }
  };

  editUserById = async (req, res) => {
    const data = req.body;
    try {
      userDal.editUserById(data);
      res.status(200).json({ message: 'Editado satisfactoriamente' });
    } catch (error) {
      res.status(500).json({ error: 'Error actualizando el usuario' });
    }
  };

  login = async (req, res) => {
    try {
      const { email, password } = req.body;
      const result = await userDal.findUserByEmailLogin(email);
      if (result.length === 0) {
        res.status(401).json({ message: 'credenciales incorrectas' });
      } else {
        let match = await compareString(password, result[0].password);

        if (!match) {
          res.status(401).json({ message: 'credenciales incorrectas' });
        } else {
          const token = jwt.sign(
            { user_id: result[0].user_id },
            process.env.TOKEN_KEY,
            { expiresIn: '1d' }
          );
          res.status(200).json({ token });
        }
      }
    } catch (error) {
      res.status(500).json({ message: 'error 500' });
    }
  };

  userById = async (req, res) => {
    try {
      const { user_id } = req;
      let userLogged = await userDal.findUserById(user_id);
      res.status(200).json({ userLogged });
    } catch (error) {
      res.status(500).json({ message: 'error 500' });
    }
  };

  delUser = async (req, res) => {
    try {
      const { user_id } = req.params;
      await userDal.delUser(user_id);
      res.status(200).json('borrado ok');
    } catch (error) {
      res.status(500).json({ message: 'ups hay algún problema' });
    }
  };

  forgetPassword = async (req, res) => {
    try {
      const { email } = req.body;
      const user = await userDal.findUserByEmail(email);
      if (!user.length) {
        return res.status(404).json({ message: 'Correo no registrado' });
      }
      const token = jwt.sign(
        { user_id: user[0].user_id, purpose: 'password-reset' },
        process.env.RESET_TOKEN_KEY,
        { expiresIn: '1h' }
      );
      await sendPasswordResetEmail({ email, token });
      res
        .status(200)
        .json({ message: 'Revisa tu correo para restablecer la contraseña' });
    } catch (error) {
      console.error('Error en forgetPassword:', error);
      res.status(500).json({ message: 'Error del servidor' });
    }
  };

  resetPassword = async (req, res) => {
    try {
      const { token } = req.params;
      const { newPassword } = req.body;
      const decoded = jwt.verify(token, process.env.RESET_TOKEN_KEY);

      if (decoded.purpose !== 'password-reset') {
        throw new Error('Token inválido');
      }

      const hashedPassword = await hashString(newPassword);
      await userDal.updatePassword(decoded.user_id, hashedPassword);
      res.status(200).json({ message: 'Contraseña actualizada correctamente' });
    } catch (error) {
      console.error('Error en resetPassword:', error);
      res.status(400).json({ message: 'Token inválido o expirado' });
    }
  };

  checkDates = async (req, res) => {
    try {
      const { start_date, end_date } = req.body;
      const f1 = parseISO(start_date);
      const f2 = parseISO(end_date);
      const numDias = differenceInCalendarDays(f2, f1);
      let selectedDates = [];
      for (let i = 0; i < numDias; i++) {
        selectedDates.push(addDays(f1, i));
      }
      const parcelId = await userDal.checkDates(selectedDates);
      res.status(200).json({ parcelId, numDias });
    } catch (error) {
      console.error('error en checkDates', error);
      res
        .status(500)
        .json({ message: 'No hay parcelas disponibles para esa fecha' });
    }
  };

  getService = async (req, res) => {
    try {
      let getService = await userDal.getService();
      res.status(200).json({ getService });
    } catch (error) {
      console.error('error del getservice', error);
      res.status(500).json(error);
    }
  };

  reserveDone = async (req, res) => {
    const { reservaData, price, parcelId, days } = req.body;
    const { user_id } = req;
    const { serviceNoIncluded } = reservaData;
    try {
      let reserveBooking = await userDal.reserveBooking(
        reservaData,
        price,
        parcelId,
        user_id
      );
      await userDal.reserveBookingParcel(reserveBooking, parcelId, days);
      let reserveBookingService = await userDal.reserveBookingService(
        reserveBooking,
        serviceNoIncluded
      );
      res.status(200).json('Todo ok');
    } catch (error) {
      console.error('error en el reserveBooking de controler', error);
      res.status(500).json(error);
      throw error;
    }
  };

  getReserveUser = async (req, res) => {
    const { user_id } = req;
    try {
      let result = await userDal.getReserveUser(user_id);
      res.status(200).json(result);
    } catch (error) {
      console.error('error en la traida de las reservas', error);
      throw error;
    }
  };
  getReserveService = async (req, res) => {
    const { booking_id } = req.body;
    try {
      let result = await userDal.getReserveService(booking_id);
      res.status(200).json(result);
    } catch (error) {
      throw error;
    }
  };
  reserveDelete = async (req, res) => {
    const { booking_id } = req.body;
    try {
      await userDal.reserveDelete(booking_id);
      res.status(200).json({ message: 'Reserva eliminada correctamente' });
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: 'Error al eliminar la reserva' });
    }
  };

  getReserveById = async (req, res) => {
    const { id } = req.params;
    try {
      const result = await userDal.getReserveById(id);
      res.status(200).json(result);
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Algo ha salido mal en la base de datos' });
    }
  };

  getServiceByReserve = async (req, res) => {
    const { id } = req.params;
    try {
      const result = await userDal.getServiceByReserve(id);
      res.status(200).json(result);
    } catch (error) {
      res
        .status(500)
        .json({ message: 'Algo ha salido mal en la base de datos' });
    }
  };

  reserveUpdate = async (req, res) => {
    try {
      const { dataPackage, dataParcelUpdate } = req.body;
      const { start_date, end_date } = dataPackage;
      const f1 = parseISO(start_date);
      const f2 = parseISO(end_date);
      const numDias = differenceInCalendarDays(f2, f1);
      let selectedDates = [];
      for (let i = 0; i < numDias; i++) {
        selectedDates.push(addDays(f1, i));
      }
      const parcelId = await userDal.checkDates(selectedDates);
      await userDal.reserveUpdate(dataPackage, parcelId);
      await userDal.parcelUpdate(dataParcelUpdate, parcelId);
      res.status(200).json('Todo okey');
    } catch (error) {
      res
        .status(500)
        .json({ message: 'No hay parcelas disponibles para esas fechas' });
    }
  };
}

export default new UserControllers();
