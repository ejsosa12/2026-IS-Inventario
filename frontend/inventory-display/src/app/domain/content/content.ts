import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SideBar } from '../../utils/side-bar/side-bar';

@Component({
  imports: [RouterOutlet, SideBar],
  selector: 'app-content',
  templateUrl: './content.html',
})
export class Content {}
